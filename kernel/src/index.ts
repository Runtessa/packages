import React from "react";
import { createRoot } from "react-dom/client";

interface Options {
  registryUrl: string;
}

export class Kernel {
  registryUrl: string;
  cache: Map<string, any>;

  constructor(options: Options) {
    this.registryUrl = (options && options.registryUrl) || "/api/registry";
    this.cache = new Map(); // key: name@version -> exports or Promise<exports>
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
      name
    )}/${encodeURIComponent(version || "latest")}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch package ${name}@${version || "latest"} (${res.status})`
      );
    }
    const payload = (await res.json()) as any;
    const dependencies = payload.dependencies || [];

    // Pre-load dependencies
    for (const dep of dependencies) {
      await this.load(dep);
    }

    const module = { exports: {} };
    const require = (pkgName: string) => this.requireLocal(pkgName);
    const factory = new Function(
      "module",
      "exports",
      "require",
      "React",
      payload.source
    );
    const result = factory(module, module.exports, require, React);
    if (result !== undefined) {
      module.exports = result;
    }
    return module.exports;
  }

  requireLocal(name: string) {
    if (name === "react" || name === "React") return React;
    const entryKey = Array.from(this.cache.keys()).find((key) =>
      key.startsWith(`${name}@`)
    );
    if (!entryKey) {
      throw new Error(
        `Module not loaded: ${name}. Use Kernel.load('${name}') first.`
      );
    }
    const entry = this.cache.get(entryKey);
    if (!entry) {
      throw new Error(`Module cache empty for: ${name}`);
    }
    if (entry.then) {
      throw new Error(
        `Module ${name} is still loading; await Kernel.load('${name}')`
      );
    }
    return entry;
  }

  async mount(name: string, containerId = "root", version = "latest") {
    const pkg = await this.load(name, version);
    console.log(pkg);
    if (!pkg) {
      throw new Error(`Package ${name} does not found`);
    }
    const container = document.getElementById(containerId)!;
    const root = createRoot(container); // Create a root
    root.render(pkg.App());
  }

  async boot(name: string, containerId = "root", version = "latest") {
    return this.mount(name, containerId, version);
  }
}

(window as any).Kernel = Kernel;
