import React from "react";
import { createRoot } from "react-dom/client";

window.React = React;
interface Options {
  registryUrl?: string;
}

export class Kernel {
  registryUrl: string;
  cache: Map<string, any>;
  private appliedStyles: Map<string, HTMLStyleElement>;

  constructor(options: Options = {}) {
    this.registryUrl = (options && options.registryUrl) || "/api/registry";
    this.cache = new Map(); // key: name@version -> exports or Promise<exports>
    this.appliedStyles = new Map();
  }

  async load(name: string, version: string = "latest") {
    const cacheKey = `${name}@${version || "latest"}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached.then ? await cached : cached;
    }

    const promise = this.fetchAndEval(name, version).then((exports) => {
      this.cache.set(cacheKey, exports);
      return exports;
    });

    this.cache.set(cacheKey, promise);
    return promise;
  }

  async fetchAndEval(name: string, version: string) {
    const url = `${this.registryUrl}/${encodeURIComponent(
      name,
    )}/${encodeURIComponent(version || "latest")}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch package ${name}@${version || "latest"} (${res.status})`,
      );
    }
    const payload = (await res.json()) as {
      source: string;
      dependencies?: string[];
      fileExtension?: string;
    };
    const dependencies = payload.dependencies || [];
    const fileExtension = (payload.fileExtension || "js").toLowerCase();
    const cacheKey = `${name}@${version || "latest"}`;

    // Pre-load dependencies
    for (const dep of dependencies) {
      await this.load(dep);
    }

    if (fileExtension === "css") {
      const cssText = payload.source || "";
      const styleElement = this.injectCss(cacheKey, cssText);
      return {
        fileExtension,
        cssText,
        styleElement,
      };
    }

    const module = { exports: {} as any };
    const require = (pkgName: string) => this.requireLocal(pkgName);
    const source = this.decorateBundleSource(payload.source || "");
    const factory = new Function(
      "module",
      "exports",
      "require",
      "React",
      source,
    );
    const result = factory(module, module.exports, require, React);
    if (result !== undefined) {
      module.exports = result;
    }
    module.exports = this.wrapExports(module.exports);
    return module.exports;
  }

  private injectCss(cacheKey: string, cssText: string) {
    if (typeof document === "undefined") return null;
    const existing = this.appliedStyles.get(cacheKey);
    if (existing) {
      if (existing.textContent !== cssText) {
        existing.textContent = cssText;
      }
      return existing;
    }
    const style = document.createElement("style");
    style.setAttribute("data-ui-style", cacheKey);
    style.textContent = cssText;
    document.head.appendChild(style);
    this.appliedStyles.set(cacheKey, style);
    return style;
  }

  requireLocal(name: string) {
    if (name === "react" || name === "React") return React;
    const entryKey = Array.from(this.cache.keys()).find((key) =>
      key.startsWith(`${name}@`),
    );
    if (!entryKey) {
      throw new Error(
        `Module not loaded: ${name}. Use Kernel.load('${name}') first.`,
      );
    }
    const entry = this.cache.get(entryKey);
    if (!entry) {
      throw new Error(`Module cache empty for: ${name}`);
    }
    if (entry.then) {
      throw new Error(
        `Module ${name} is still loading; await Kernel.load('${name}')`,
      );
    }
    return entry;
  }

  private decorateBundleSource(source: string) {
    if (!source) return source;
    if (!source.includes("const __modules") || !source.includes("const __require")) {
      return source;
    }
    const suffix = `
;try {
  if (typeof __require === 'function') {
    const entry = module && module.exports ? module.exports : null;
    const canAttach = entry && (typeof entry === 'object' || typeof entry === 'function');
    if (canAttach) {
      entry.__kernelRequire = __require;
      const moduleKeys = (typeof __modules === 'object' && __modules) ? Object.keys(__modules) : [];
      entry.__kernelModules = moduleKeys;
    }
  }
} catch (e) {}
`;
    return `${source}\n${suffix}`;
  }

  private wrapExports(value: any) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return value;
    }
    if ((value as any).__kernelWrapped) return value;
    const kernelRequire = (value as any).__kernelRequire;
    const moduleKeys = (value as any).__kernelModules;
    if (typeof kernelRequire !== "function" || !Array.isArray(moduleKeys)) {
      return value;
    }

    const resolved = new Map<string, any>();
    const moduleKeySet = new Set<string>(moduleKeys);
    const getBasename = (key: string) => {
      const normalized = key.replace(/\\/g, "/");
      const last = normalized.split("/").pop() || normalized;
      return last.replace(/\.[^.]+$/, "");
    };

    const resolveExport = (prop: string) => {
      if (resolved.has(prop)) return resolved.get(prop);
      const propLower = prop.toLowerCase();
      const preferred: string[] = [];
      const fallback: string[] = [];
      moduleKeys.forEach((key) => {
        if (key.endsWith(".css")) return;
        const base = getBasename(key).toLowerCase();
        if (base.includes(propLower)) {
          preferred.push(key);
        } else {
          fallback.push(key);
        }
      });
      const ordered = preferred.concat(fallback);
      const preferredSet = new Set(preferred);

      for (const key of ordered) {
        if (!moduleKeySet.has(key)) continue;
        let mod: any;
        try {
          mod = kernelRequire(key);
        } catch (err) {
          if (preferredSet.has(key)) {
            throw err;
          }
          continue;
        }
        if (!mod) continue;
        if (prop === "default" && mod.default !== undefined) {
          resolved.set(prop, mod.default);
          return mod.default;
        }
        if (Object.prototype.hasOwnProperty.call(mod, prop)) {
          resolved.set(prop, mod[prop]);
          return mod[prop];
        }
      }
      resolved.set(prop, undefined);
      return undefined;
    };

    const handler: ProxyHandler<any> = {
      get(target, prop) {
        if (typeof prop !== "string") return (target as any)[prop];
        if (
          prop === "__kernelRequire" ||
          prop === "__kernelModules" ||
          prop === "__kernelWrapped"
        ) {
          return (target as any)[prop];
        }
        if (Object.prototype.hasOwnProperty.call(target, prop)) {
          return (target as any)[prop];
        }
        return resolveExport(prop);
      },
    };

    const proxy = new Proxy(value, handler);
    (proxy as any).__kernelWrapped = true;
    return proxy;
  }

  async mount(name: string, containerId = "root", version = "latest") {
    const pkg = await this.load(name, version);
    console.log(pkg);
    if (!pkg) {
      throw new Error(`Package ${name} does not found`);
    }
    const container = document.getElementById(containerId)!;
    const root = createRoot(container); // Create a root
    const Component = pkg.App ?? pkg.default ?? pkg;
    if (!Component) {
      throw new Error(`Package ${name} has no App export`);
    }
    const element = React.isValidElement(Component)
      ? Component
      : React.createElement(Component);
    root.render(element);
  }

  async boot(name: string, containerId = "root", version = "latest") {
    return this.mount(name, containerId, version);
  }
}

(window as any).Kernel = Kernel;
