(function () {
  class Kernel {
    constructor(options) {
      this.registryUrl = (options && options.registryUrl) || '/api/registry';
      this.cache = new Map(); // key: name@version -> exports or Promise<exports>
    }

    async load(name, version = 'latest') {
      const cacheKey = `${name}@${version || 'latest'}`;
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

    async fetchAndEval(name, version) {
      const url = `${this.registryUrl}/${encodeURIComponent(name)}/${encodeURIComponent(
        version || 'latest',
      )}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch package ${name}@${version || 'latest'} (${res.status})`);
      }
      const payload = await res.json();
      const dependencies = payload.dependencies || [];

      // Pre-load dependencies
      for (const dep of dependencies) {
        await this.load(dep);
      }

      const module = { exports: {} };
      const require = (pkgName) => this.requireLocal(pkgName);
      const factory = new Function('module', 'exports', 'require', 'React', 'ReactDOM', payload.source);
      const result = factory(module, module.exports, require, window.React, window.ReactDOM);
      if (result !== undefined) {
        module.exports = result;
      }
      return module.exports;
    }

    requireLocal(name) {
      if (name === 'react' || name === 'React') return window.React;
      if (name === 'react-dom' || name === 'ReactDOM') return window.ReactDOM;
      const entryKey = Array.from(this.cache.keys()).find((key) => key.startsWith(`${name}@`));
      if (!entryKey) {
        throw new Error(`Module not loaded: ${name}. Use Kernel.load('${name}') first.`);
      }
      const entry = this.cache.get(entryKey);
      if (!entry) {
        throw new Error(`Module cache empty for: ${name}`);
      }
      if (entry.then) {
        throw new Error(`Module ${name} is still loading; await Kernel.load('${name}')`);
      }
      return entry;
    }

    async mount(name, containerId = 'root', version = 'latest') {
      const pkg = await this.load(name, version);
      if (!pkg || typeof pkg.mount !== 'function') {
        throw new Error(`Package ${name} does not export a mount(container) function`);
      }
      const el = document.getElementById(containerId);
      if (!el) {
        throw new Error(`Container #${containerId} not found`);
      }
      await pkg.mount(el);
      return pkg;
    }

    async boot(name, containerId = 'root', version = 'latest') {
      return this.mount(name, containerId, version);
    }
  }

  window.Kernel = new Kernel();
})();
