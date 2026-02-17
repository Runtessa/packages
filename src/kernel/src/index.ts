import React from "react";
import { createRoot } from "react-dom/client";

window.React = React;
interface Options {
  registryUrl?: string;
  apiBaseUrl?: string;
  tenantHost?: string;
  preview?: boolean;
}

type ApiRequestOptions = {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
  rawBody?: BodyInit | null;
  json?: boolean;
  redirectOnUnauthorized?: boolean;
};

type ApiClient = {
  request: (path: string, options?: ApiRequestOptions) => Promise<Response>;
  get: (path: string, options?: Omit<ApiRequestOptions, "method" | "body">) => Promise<Response>;
  post: (path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">) => Promise<Response>;
  put: (path: string, body?: unknown, options?: Omit<ApiRequestOptions, "method" | "body">) => Promise<Response>;
  del: (path: string, options?: Omit<ApiRequestOptions, "method" | "body">) => Promise<Response>;
};

type KernelDataContext = {
  api: ApiClient;
  tenantHost: string | null;
  previewMode: boolean;
  getToken: () => string | null;
};

const DATA_CONTEXT_PACKAGE_NAMES = new Set([
  "@app/datacontext",
  "@idp/datacontext",
  "idp/datacontext",
]);
const KERNEL_BUILTIN_MODULES = new Set([
  "react",
  "React",
  "react-dom",
  "react-dom/client",
  ...Array.from(DATA_CONTEXT_PACKAGE_NAMES),
]);

export class Kernel {
  registryUrl: string;
  apiBaseUrl: string;
  tenantHost: string | null;
  previewMode: boolean;
  cache: Map<string, any>;
  api: ApiClient;
  private appliedStyles: Map<string, HTMLStyleElement>;
  private dataContextExports: any | null;
  private authRedirectInFlight: boolean;
  private renewIntervalId: number | null;
  private renewPending: boolean;
  private lastRenewAtMs: number;

  constructor(options: Options = {}) {
    this.registryUrl = (options && options.registryUrl) || "/api/registry";
    this.apiBaseUrl = (options && options.apiBaseUrl) || "";
    this.tenantHost = (options && options.tenantHost) || null;
    this.previewMode = Boolean(options && options.preview);
    this.cache = new Map(); // key: name@version -> exports or Promise<exports>
    this.appliedStyles = new Map();
    this.dataContextExports = null;
    this.authRedirectInFlight = false;
    this.renewIntervalId = null;
    this.renewPending = false;
    this.lastRenewAtMs = 0;
    this.api = this.createApiClient();
    this.initGlobalContext();
    this.initSessionRenewal();
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
    const headers = this.buildAuthHeaders();
    const res = await fetch(url, { headers, credentials: "include" });
    this.maybeHandleUnauthorized(res, { requestUrl: url });
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
    const dependencies = [...(payload.dependencies || [])];
    const fileExtension = (payload.fileExtension || "js").toLowerCase();
    const tailwindName = `${name}__tw`;
    const shouldAttachTailwind =
      fileExtension !== "css" &&
      !name.endsWith("__tw") &&
      !/tailwind\.config/i.test(name) &&
      !dependencies.includes(tailwindName);
    if (shouldAttachTailwind) {
      dependencies.push(tailwindName);
    }
    const cacheKey = `${name}@${version || "latest"}`;

    // Pre-load dependencies
    for (const dep of dependencies) {
      if (KERNEL_BUILTIN_MODULES.has(dep)) {
        continue;
      }
      if (shouldAttachTailwind && dep === tailwindName) {
        try {
          await this.load(dep);
        } catch {
          // tailwind package is optional; ignore if not found
        }
        continue;
      }
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

  private initGlobalContext() {
    if (typeof window === "undefined") return;
    const win = window as any;
    if (win.__IDP_TENANT_HOST__) {
      this.tenantHost = win.__IDP_TENANT_HOST__ || this.tenantHost;
    }
    if (win.__IDP_API_BASE__) {
      this.apiBaseUrl = win.__IDP_API_BASE__ || this.apiBaseUrl;
    }
    if (win.__IDP_PREVIEW__) {
      this.previewMode = true;
    }
    win.IDP = win.IDP || {};
    win.IDP.kernel = this;
    win.IDP.api = this.api;
    win.IDP.getToken = () => this.getToken();
    win.IDP.datacontext = this.getDataContextModule();
  }

  private getToken() {
    if (typeof window === "undefined") return null;
    return window.localStorage?.getItem("idp_token") || null;
  }

  private getTenantHost() {
    if (this.tenantHost) return this.tenantHost;
    if (typeof window === "undefined") return null;
    return (window as any).__IDP_TENANT_HOST__ || null;
  }

  private buildReturnTo() {
    if (typeof window === "undefined") return "/";
    const { pathname, search, hash } = window.location;
    return `${pathname || "/"}${search || ""}${hash || ""}`;
  }

  private redirectToLogin() {
    if (typeof window === "undefined") return;
    if (this.authRedirectInFlight) return;
    this.authRedirectInFlight = true;
    const returnTo = this.buildReturnTo();
    const next = `/login?returnTo=${encodeURIComponent(returnTo)}`;
    window.location.assign(next);
  }

  private shouldSkipUnauthorizedRedirect(requestUrl?: string) {
    if (!requestUrl) return false;
    const toPath = (value: string) => {
      try {
        if (typeof window !== "undefined") {
          return new URL(value, window.location.origin).pathname;
        }
        return new URL(value).pathname;
      } catch {
        return value.split("?")[0].split("#")[0];
      }
    };
    const pathname = toPath(requestUrl);
    return pathname === "/api/auth/session" || pathname === "/api/auth/session/renew";
  }

  private maybeHandleUnauthorized(
    res: Response,
    options: {
      requestUrl?: string;
      redirectOnUnauthorized?: boolean;
    } = {},
  ) {
    if (res.status !== 401) return;
    if (this.previewMode) return;
    if (options.redirectOnUnauthorized === false) return;
    if (this.shouldSkipUnauthorizedRedirect(options.requestUrl || res.url || "")) return;
    this.redirectToLogin();
  }

  private async renewTenantSession(force = false) {
    if (typeof window === "undefined") return;
    if (this.previewMode) return;
    if (this.renewPending) return;
    const now = Date.now();
    if (!force && now - this.lastRenewAtMs < 45_000) return;

    this.renewPending = true;
    try {
      await fetch(this.resolveApiUrl("/api/auth/session/renew"), {
        method: "POST",
        credentials: "include",
        headers: this.buildAuthHeaders(),
      });
      this.lastRenewAtMs = Date.now();
    } catch {
      // ignore keepalive errors; next request can recover session state
    } finally {
      this.renewPending = false;
    }
  }

  private initSessionRenewal() {
    if (typeof window === "undefined") return;
    if (this.previewMode) return;

    const onUserActivity = () => {
      void this.renewTenantSession(false);
    };

    this.renewIntervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void this.renewTenantSession(false);
    }, 120_000);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void this.renewTenantSession(true);
      }
    });
    window.addEventListener("focus", () => {
      void this.renewTenantSession(true);
    });
    window.addEventListener("pointerdown", onUserActivity, { passive: true });
    window.addEventListener("keydown", onUserActivity);
    window.addEventListener("scroll", onUserActivity, { passive: true });
  }

  private buildAuthHeaders(extra?: HeadersInit) {
    const headers = new Headers(extra || {});
    const tenantHost = this.getTenantHost();
    if (tenantHost && !headers.has("X-Tenant-Host")) {
      headers.set("X-Tenant-Host", tenantHost);
    }
    if (this.previewMode && !headers.has("X-Dev-Preview")) {
      headers.set("X-Dev-Preview", "true");
    }
    return headers;
  }

  private resolveApiUrl(path: string, baseUrl?: string) {
    if (/^https?:\/\//i.test(path)) return path;
    const base = (baseUrl ?? this.apiBaseUrl ?? "").replace(/\/$/, "");
    if (!base) return path;
    return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
  }

  private createApiClient(baseUrl?: string): ApiClient {
    const request = async (path: string, options: ApiRequestOptions = {}) => {
      const url = this.resolveApiUrl(path, baseUrl);
      const headers = this.buildAuthHeaders(options.headers);
      let body: BodyInit | null | undefined = options.rawBody ?? null;
      if (body == null && options.body !== undefined) {
        if (options.body instanceof FormData || options.body instanceof Blob) {
          body = options.body as BodyInit;
        } else {
          body = JSON.stringify(options.body);
          if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
          }
        }
      }
      return fetch(url, {
        credentials: "include",
        method: options.method ?? "GET",
        headers,
        body: body ?? undefined,
      }).then((res) => {
        this.maybeHandleUnauthorized(res, {
          requestUrl: url,
          redirectOnUnauthorized: options.redirectOnUnauthorized,
        });
        return res;
      });
    };
    return {
      request,
      get: (path, options) => request(path, { ...options, method: "GET" }),
      post: (path, body, options) =>
        request(path, { ...options, method: "POST", body }),
      put: (path, body, options) =>
        request(path, { ...options, method: "PUT", body }),
      del: (path, options) => request(path, { ...options, method: "DELETE" }),
    };
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

  private buildDataContextValue(): KernelDataContext {
    return {
      api: this.api,
      tenantHost: this.getTenantHost(),
      previewMode: this.previewMode,
      getToken: () => this.getToken(),
    };
  }

  private getDataContextModule() {
    if (this.dataContextExports) return this.dataContextExports;

    const DataContext = React.createContext<KernelDataContext>(
      this.buildDataContextValue()
    );

    const DataProvider = ({ children }: { children?: React.ReactNode }) =>
      React.createElement(
        DataContext.Provider,
        { value: this.buildDataContextValue() },
        children
      );

    const useDataContext = () => React.useContext(DataContext);
    const useApiClient = () => useDataContext().api;
    const getApiClient = () => this.api;

    const exportsObject = {
      DataContext,
      DataProvider,
      useDataContext,
      useApiClient,
      getApiClient,
      api: this.api,
      default: {
        DataContext,
        DataProvider,
        useDataContext,
        useApiClient,
        getApiClient,
        api: this.api,
      },
    };
    this.dataContextExports = exportsObject;
    return this.dataContextExports;
  }

  requireLocal(name: string) {
    if (name === "react" || name === "React") return React;
    if (name === "react-dom/client") return { createRoot };
    if (name === "react-dom") return { createRoot };
    if (DATA_CONTEXT_PACKAGE_NAMES.has(name)) {
      return this.getDataContextModule();
    }
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
