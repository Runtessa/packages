# Project Code Dump

_Generated: 2026-01-06T14:08:53.005Z_


## .gitignore

```
# Dependencies
node_modules/

# Build outputs
dist/

# Env and secrets
.env
.env.local

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Editor/OS
.DS_Store
Thumbs.db
*.swp
*.swo
.idea/
.vscode/

```

## package-lock.json

_Skipped: file size 241737 exceeds 204800 bytes_

## package.json

```json
{
  "name": "idpcore",
  "version": "0.1.0",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts",
    "seed": "ts-node src/seed.ts",
    "seed-packages": "ts-node src/seed-packages.ts",
    "dump": "node dump-project.js"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.516.0",
    "@aws-sdk/s3-request-presigner": "^3.516.0",
    "ioredis": "^5.4.1",
    "kafkajs": "^2.2.4",
    "mssql": "^10.0.2",
    "mysql2": "^3.9.7",
    "express": "^4.19.2",
    "pg": "^8.11.3",
    "reflect-metadata": "^0.1.13",
    "typeorm": "^0.3.20",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/mssql": "^9.1.5",
    "@types/node": "^20.11.24",
    "@types/pg": "^8.16.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}

```

## public/ide.html

```
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>IDP Studio (Web)</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #0f172a;
        color: #e2e8f0;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      }
    </style>
    <script>
      let loaderBase = null;

      function loadScript(src) {
        return new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = src;
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      (async () => {
        const cdnLoader = 'https://aka.ms/vscode-web-release/0.1.0/dist/out/vs/loader.js';
        const localLoader = '/vscode/out/vs/loader.js';

        let loaded = false;
        try {
          await loadScript(cdnLoader);
          loaded = typeof window.require === 'function';
          if (loaded) loaderBase = 'cdn';
        } catch (err) {
          console.warn('Failed to load VS Code loader from CDN:', err);
        }

        if (!loaded) {
          try {
            await loadScript(localLoader);
            loaded = typeof window.require === 'function';
            if (loaded) loaderBase = 'local';
          } catch (err) {
            console.error('Failed to load VS Code loader from local path:', err);
          }
        }

        if (!loaded) {
          document.body.innerHTML =
            '<div style="padding:24px;font-family:Segoe UI,system-ui,sans-serif;color:#e2e8f0;">Failed to load VS Code loader. Check network access or ensure /public/vscode assets exist.</div>';
        }
      })();
    </script>
  </head>
  <body>
    <script>
      function bootstrapWorkbench() {
        if (typeof window.require !== 'function') {
          setTimeout(bootstrapWorkbench, 50);
          return;
        }

        const cdnVsPath = 'https://aka.ms/vscode-web-release/0.1.0/dist/out/vs';
        const localVsPath = '/vscode/out/vs';
        const resolvedVsPath = loaderBase === 'local' ? localVsPath : cdnVsPath;
        require.config({ paths: { vs: resolvedVsPath } });

        require(['vs/code/browser/workbench/workbench'], function (workbench) {
          workbench.create(document.body, {
            folderUri: { scheme: 'idp', path: '/' },
            productConfiguration: {
              nameShort: 'IDP Studio',
              nameLong: 'IDP Studio',
              extensionsGallery: { serviceUrl: '' },
            },
            additionalBuiltinExtensions: [
              {
                scheme: window.location.protocol.replace(':', ''),
                authority: window.location.host,
                path: '/extension',
              },
            ],
          });
        });
      }

      bootstrapWorkbench();
    </script>
  </body>
</html>

```

## public/index.html

```
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Server-Driven Micro-Frontend</title>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="/kernel.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script>
      (async () => {
        if (window.Kernel) {
          await window.Kernel.boot('@app/dashboard');
        } else {
          console.error('Kernel failed to load');
        }
      })();
    </script>
  </body>
</html>

```

## public/kernel.js

```js
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

```

## public/login.html

```
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>IDP Login</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        margin: 0;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
      }
      .card {
        width: 360px;
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 15px 40px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 4px;
        font-size: 20px;
        color: #93c5fd;
      }
      p {
        margin: 0 0 16px;
        color: #94a3b8;
        font-size: 13px;
      }
      label {
        display: block;
        margin-bottom: 6px;
        font-weight: 600;
        font-size: 13px;
        color: #cbd5e1;
      }
      input {
        width: 100%;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid #1f2937;
        background: #0b1220;
        color: #e2e8f0;
        font-size: 14px;
        box-sizing: border-box;
      }
      input:focus {
        outline: 2px solid #3b82f6;
        outline-offset: 2px;
      }
      button {
        width: 100%;
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 8px;
        border: none;
        background: linear-gradient(90deg, #2563eb, #7c3aed);
        color: #f8fafc;
        font-weight: 700;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .result {
        margin-top: 16px;
        padding: 12px;
        border-radius: 8px;
        background: #0b1220;
        border: 1px solid #1f2937;
        font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
          monospace;
        font-size: 12px;
        word-break: break-all;
      }
      .error {
        color: #fca5a5;
      }
      .info {
        color: #a5b4fc;
        font-size: 12px;
        margin-top: 8px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>IDP Login</h1>
      <p>Authenticate to retrieve a bearer token for the IDP VFS.</p>
      <form id="login-form">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="username" required />

        <label for="password" style="margin-top: 12px">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />

        <button id="submit-btn" type="submit">Login</button>
      </form>
      <div class="info">
        Hostname detected: <span id="hostname"></span>. Ensure it matches a tenant (e.g. dev.internal.local).
      </div>
      <div id="result" class="result" hidden></div>
    </div>

    <script>
      const form = document.getElementById('login-form');
      const result = document.getElementById('result');
      const hostnameEl = document.getElementById('hostname');
      const submitBtn = document.getElementById('submit-btn');
      hostnameEl.textContent = window.location.hostname || 'unknown';

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        result.hidden = true;
        result.classList.remove('error');

        const email = (document.getElementById('email').value || '').trim().toLowerCase();
        const password = (document.getElementById('password').value || '').trim();
        if (!email || !password) {
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';

        try {
          const response = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload?.error || `Login failed (${response.status})`);
          }

          const token = payload.token;
          result.hidden = false;
          result.textContent = `Bearer ${token}`;
          await navigator.clipboard?.writeText(token).catch(() => undefined);
        } catch (err) {
          result.hidden = false;
          result.classList.add('error');
          result.textContent = err.message || 'Login failed';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Login';
        }
      });
    </script>
  </body>
</html>

```

## src/app/controllers/AdminController.ts

```ts
import { NextFunction, Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { Tenant, TenantStage } from '../../entities/Tenant';

export class AdminController {
  constructor(private readonly dataSource: DataSource) {}

  createTenant = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { hostname, stage, resourceConfig } = req.body ?? {};
      if (!hostname) {
        throw new AppError('hostname is required', 400);
      }

      const normalizedHost = String(hostname).toLowerCase();
      const resolvedStage = Object.values(TenantStage).includes(stage)
        ? (stage as TenantStage)
        : TenantStage.DEV;
      const config = this.normalizeResourceConfig(resourceConfig);

      const repo = this.dataSource.getRepository(Tenant);
      const existing = await repo.findOne({ where: { hostname: normalizedHost } });
      if (existing) {
        return res.status(409).json({ error: 'Tenant already exists' });
      }

      const tenant = repo.create({
        hostname: normalizedHost,
        stage: resolvedStage,
        resourceConfig: config,
        isSuspended: false,
      });

      await repo.save(tenant);
      res.status(201).json({
        id: tenant.id,
        hostname: tenant.hostname,
        stage: tenant.stage,
        resourceConfig: tenant.resourceConfig,
      });
    } catch (error) {
      next(error);
    }
  };

  private normalizeResourceConfig(input: unknown): { memory: number; timeout: number } {
    const defaults = { memory: 512, timeout: 5_000 };
    if (!input || typeof input !== 'object') {
      return defaults;
    }
    const memory = Number((input as Record<string, unknown>).memory) || defaults.memory;
    const timeout = Number((input as Record<string, unknown>).timeout) || defaults.timeout;
    return { memory, timeout };
  }
}

```

## src/app/controllers/AuthController.ts

```ts
import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { CryptoService } from '../../core/security/CryptoService';
import { Account, AccountRole } from '../../entities/Account';
import { TenantRequest } from '../../types/RequestContext';

export class AuthController {
  constructor(private readonly dataSource: DataSource, private readonly cryptoService: CryptoService) {}

  register = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.tenant) {
        throw new AppError('Tenant required', 400);
      }

      const { email, password, role } = req.body ?? {};
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const normalizedEmail = String(email).toLowerCase();
      const resolvedRole = Object.values(AccountRole).includes(role) ? role : AccountRole.DEVELOPER;

      const accountRepo = this.dataSource.getRepository(Account);
      const existing = await accountRepo.findOne({
        where: { email: normalizedEmail, tenant: { id: req.tenant.id } },
        relations: ['tenant'],
      });

      if (existing) {
        return res.status(409).json({ error: 'Account already exists' });
      }

      const passwordHash = await this.cryptoService.hashPassword(String(password));
      const account = accountRepo.create({
        email: normalizedEmail,
        passwordHash,
        role: resolvedRole as AccountRole,
        tenant: req.tenant,
      });

      await accountRepo.save(account);
      res.status(201).json({ id: account.id, email: account.email, role: account.role });
    } catch (error) {
      next(error);
    }
  };

  login = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.tenant) {
        throw new AppError('Tenant required', 400);
      }

      const { email, password } = req.body ?? {};
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const accountRepo = this.dataSource.getRepository(Account);
      const account = await accountRepo.findOne({
        where: { email: String(email).toLowerCase(), tenant: { id: req.tenant.id } },
        relations: ['tenant'],
      });

      if (!account) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const passwordMatch = await this.cryptoService.comparePassword(String(password), account.passwordHash);
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const ttlSeconds = 60 * 60; // 1 hour
      const token = this.cryptoService.signToken(
        { sub: account.id, tenantId: req.tenant.id, role: account.role },
        ttlSeconds,
      );

      res.json({ token, expiresIn: ttlSeconds });
    } catch (error) {
      next(error);
    }
  };
}

```

## src/app/controllers/Dispatcher.ts

```ts
import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { AdapterFactory } from '../../engine/AdapterFactory';
import { SandboxRunner, SandboxRequestContext } from '../../engine/SandboxRunner';
import { ModuleEntity, HttpMethod } from '../../entities/Module';
import { TenantRequest } from '../../types/RequestContext';

export class Dispatcher {
  constructor(
    private readonly dataSource: DataSource,
    private readonly adapterFactory: AdapterFactory,
    private readonly sandboxRunner: SandboxRunner,
  ) {}

  handle = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.tenant) {
        throw new AppError('Tenant required', 400);
      }

      const normalizedMethod = req.method.toUpperCase();
      if (!Object.values(HttpMethod).includes(normalizedMethod as HttpMethod)) {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const moduleRepo = this.dataSource.getRepository(ModuleEntity);
      const modules = await moduleRepo.find({
        where: { tenant: { id: req.tenant.id }, method: normalizedMethod as HttpMethod },
        order: { routePath: 'ASC' },
      });

      const matchResult = this.findMatchingModule(modules, req.path);
      if (!matchResult) {
        return res.status(404).json({ error: 'Module not found' });
      }

      const { module, params } = matchResult;

      const adapters = await this.adapterFactory.build(req.tenant);
      const requestContext: SandboxRequestContext = {
        path: req.path,
        method: normalizedMethod,
        headers: this.normalizeHeaders(req.headers),
        query: { ...(req.query as Record<string, unknown>) },
        body: req.body,
        params,
        tenant: {
          id: req.tenant.id,
          hostname: req.tenant.hostname,
          stage: req.tenant.stage,
          resourceConfig: req.tenant.resourceConfig ?? { memory: 512, timeout: 5_000 },
        },
        account: req.account
          ? { id: req.account.id, email: req.account.email, role: req.account.role }
          : undefined,
      };

      const sandboxResult = await this.sandboxRunner.run(module.code, {
        request: requestContext,
        adapters,
      });

      res.status(sandboxResult.statusCode ?? 200);
      if (sandboxResult.headers) {
        for (const [key, value] of Object.entries(sandboxResult.headers)) {
          res.setHeader(key, value);
        }
      }
      res.send(sandboxResult.body ?? null);
    } catch (error) {
      next(error);
    }
  };

  private normalizeHeaders(headers: TenantRequest['headers']): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (!value) {
        continue;
      }

      if (Array.isArray(value)) {
        normalized[key] = value.join(',');
      } else {
        normalized[key] = String(value);
      }
    }
    return normalized;
  }

  private findMatchingModule(
    modules: ModuleEntity[],
    path: string,
  ): { module: ModuleEntity; params: Record<string, string> } | null {
    for (const mod of modules) {
      const params = this.matchPath(mod.routePath, path);
      if (params) {
        return { module: mod, params };
      }
    }
    return null;
  }

  private matchPath(pattern: string, actual: string): Record<string, string> | null {
    const patternParts = pattern.split('/').filter(Boolean);
    const actualParts = actual.split('/').filter(Boolean);

    if (patternParts.length !== actualParts.length) {
      return null;
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i += 1) {
      const pp = patternParts[i];
      const ap = actualParts[i];
      if (pp.startsWith(':')) {
        params[pp.substring(1)] = decodeURIComponent(ap);
      } else if (pp !== ap) {
        return null;
      }
    }
    return params;
  }
}

```

## src/app/controllers/FileSystemController.ts

```ts
import path from 'path';
import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { ModuleEntity, HttpMethod } from '../../entities/Module';
import { UIPackage } from '../../entities/UIEntities';
import { TenantRequest } from '../../types/RequestContext';

type EntryType = 'FILE' | 'DIR';

interface VfsStat {
  type: EntryType;
  size: number;
  ctime: number;
  mtime: number;
}

export class FileSystemController {
  constructor(private readonly dataSource: DataSource) {}

  stat = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const tenant = this.ensureTenant(req);
      const targetPath = this.normalizePath(req.query.path);

      if (!targetPath) {
        return res.json(this.dirStat());
      }

      if (targetPath === 'backend') {
        return res.json(await this.statBackend(tenant.id, ''));
      }
      if (targetPath.startsWith('backend/')) {
        const relative = targetPath.substring('backend/'.length);
        const stats = await this.statBackend(tenant.id, relative);
        if (!stats) {
          return res.status(404).json({ error: 'Path not found' });
        }
        return res.json(stats);
      }

      if (targetPath === 'frontend') {
        return res.json(await this.statFrontend(tenant.id, ''));
      }
      if (targetPath.startsWith('frontend/')) {
        const relative = targetPath.substring('frontend/'.length);
        const stats = await this.statFrontend(tenant.id, relative);
        if (!stats) {
          return res.status(404).json({ error: 'Path not found' });
        }
        return res.json(stats);
      }

      return res.status(404).json({ error: 'Path not found' });
    } catch (error) {
      next(error);
    }
  };

  read = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const tenant = this.ensureTenant(req);
      const targetPath = this.normalizePath(req.query.path);

      if (!targetPath || targetPath.endsWith('/')) {
        throw new AppError('File path required', 400);
      }

      if (targetPath.startsWith('backend/')) {
        const relative = targetPath.substring('backend/'.length);
        const content = await this.readBackendFile(tenant.id, relative);
        if (content === null) {
          return res.status(404).json({ error: 'File not found' });
        }
        return res.json({ content });
      }

      if (targetPath.startsWith('frontend/')) {
        const relative = targetPath.substring('frontend/'.length);
        const content = await this.readFrontendFile(tenant.id, relative);
        if (content === null) {
          return res.status(404).json({ error: 'File not found' });
        }
        return res.json({ content });
      }

      return res.status(400).json({ error: 'Unsupported path' });
    } catch (error) {
      next(error);
    }
  };

  write = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const tenant = this.ensureTenant(req);
      const { path: rawPath, content } = req.body ?? {};

      if (!rawPath || typeof rawPath !== 'string') {
        throw new AppError('path is required', 400);
      }
      if (typeof content !== 'string') {
        throw new AppError('content must be a string', 400);
      }

      const targetPath = this.normalizePath(rawPath);
      if (targetPath.startsWith('backend/')) {
        const relative = targetPath.substring('backend/'.length);
        await this.writeBackendFile(tenant.id, tenant, relative, content);
        return res.json({ ok: true });
      }

      if (targetPath.startsWith('frontend/')) {
        const relative = targetPath.substring('frontend/'.length);
        await this.writeFrontendFile(tenant.id, tenant, relative, content);
        return res.json({ ok: true });
      }

      throw new AppError('Unsupported path', 400);
    } catch (error) {
      next(error);
    }
  };

  readdir = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const tenant = this.ensureTenant(req);
      const targetPath = this.normalizePath(req.query.path);

      if (!targetPath) {
        return res.json([
          ['backend', 'DIR'],
          ['frontend', 'DIR'],
        ] satisfies [string, EntryType][]);
      }

      if (targetPath === 'backend' || targetPath.startsWith('backend/')) {
        const relative = targetPath === 'backend' ? '' : targetPath.substring('backend/'.length);
        const entries = await this.listBackendEntries(tenant.id, relative);
        if (!entries.length && relative) {
          return res.status(404).json({ error: 'Path not found' });
        }
        return res.json(entries);
      }

      if (targetPath === 'frontend' || targetPath.startsWith('frontend/')) {
        const relative = targetPath === 'frontend' ? '' : targetPath.substring('frontend/'.length);
        const entries = await this.listFrontendEntries(tenant.id, relative);
        if (!entries.length && relative) {
          return res.status(404).json({ error: 'Path not found' });
        }
        return res.json(entries);
      }

      return res.status(404).json({ error: 'Path not found' });
    } catch (error) {
      next(error);
    }
  };

  private ensureTenant(req: TenantRequest) {
    if (!req.tenant) {
      throw new AppError('Tenant required', 400);
    }
    return req.tenant;
  }

  private normalizePath(raw: unknown): string {
    if (raw === undefined || raw === null) {
      return '';
    }
    const value = Array.isArray(raw) ? raw[0] : raw;
    const decoded = decodeURIComponent(String(value));
    const trimmed = decoded.trim();
    if (!trimmed || trimmed === '/') {
      return '';
    }

    const withoutLeading = trimmed.replace(/^\/+/, '');
    const normalized = path.posix.normalize(withoutLeading);
    return normalized === '.' ? '' : normalized;
  }

  private dirStat(reference?: { ctime: number; mtime: number }): VfsStat {
    const now = Date.now();
    return {
      type: 'DIR',
      size: 0,
      ctime: reference?.ctime ?? now,
      mtime: reference?.mtime ?? now,
    };
  }

  private async statBackend(tenantId: string, relative: string): Promise<VfsStat | null> {
    const repo = this.dataSource.getRepository(ModuleEntity);
    const modules = await repo.find({
      where: { tenant: { id: tenantId } },
      select: ['routePath', 'method', 'createdAt', 'updatedAt'],
    });

    if (!relative) {
      return this.dirStat(this.moduleTimes(modules));
    }

    const fileInfo = this.parseBackendFile(relative);
    if (fileInfo) {
      const record = await repo.findOne({
        where: { tenant: { id: tenantId }, routePath: fileInfo.routePath, method: fileInfo.method },
      });
      if (!record) {
        return null;
      }
      return {
        type: 'FILE',
        size: Buffer.byteLength(record.code, 'utf8'),
        ctime: record.createdAt.getTime(),
        mtime: record.updatedAt.getTime(),
      };
    }

    const parentSegments = relative.split('/').filter(Boolean);
    const matches = modules.filter((mod) => this.startsWithSegments(this.routeSegments(mod.routePath), parentSegments));
    if (!matches.length) {
      return null;
    }
    return this.dirStat(this.moduleTimes(matches));
  }

  private async statFrontend(tenantId: string, relative: string): Promise<VfsStat | null> {
    const packages = await this.getLatestPackages(tenantId);

    if (!relative) {
      return this.dirStat(this.packageTimes(Array.from(packages.values())));
    }

    const pkgName = this.packageNameFromPath(relative);
    if (pkgName) {
      const pkg = packages.get(pkgName);
      if (!pkg) {
        return null;
      }
      return {
        type: 'FILE',
        size: Buffer.byteLength(pkg.codeBlob, 'utf8'),
        ctime: pkg.createdAt.getTime(),
        mtime: pkg.updatedAt.getTime(),
      };
    }

    const parentSegments = relative.split('/').filter(Boolean);
    const matches = Array.from(packages.values()).filter((pkg) =>
      this.startsWithSegments(pkg.name.split('/'), parentSegments),
    );
    if (!matches.length) {
      return null;
    }
    return this.dirStat(this.packageTimes(matches));
  }

  private async readBackendFile(tenantId: string, relative: string): Promise<string | null> {
    const parsed = this.parseBackendFile(relative);
    if (!parsed) {
      return null;
    }
    const repo = this.dataSource.getRepository(ModuleEntity);
    const mod = await repo.findOne({
      where: { tenant: { id: tenantId }, routePath: parsed.routePath, method: parsed.method },
    });
    return mod ? mod.code : null;
  }

  private async readFrontendFile(tenantId: string, relative: string): Promise<string | null> {
    const pkgName = this.packageNameFromPath(relative);
    if (!pkgName) {
      return null;
    }
    const packages = await this.getLatestPackages(tenantId);
    const pkg = packages.get(pkgName);
    return pkg ? pkg.codeBlob : null;
  }

  private async writeBackendFile(
    tenantId: string,
    tenant: TenantRequest['tenant'],
    relative: string,
    content: string,
  ): Promise<void> {
    const parsed = this.parseBackendFile(relative);
    if (!parsed) {
      throw new AppError('Invalid backend path. Expected backend/<route>/<METHOD>.js', 400);
    }

    const repo = this.dataSource.getRepository(ModuleEntity);
    let mod = await repo.findOne({
      where: { tenant: { id: tenantId }, routePath: parsed.routePath, method: parsed.method },
      relations: ['tenant'],
    });

    if (!mod) {
      mod = repo.create({
        routePath: parsed.routePath,
        method: parsed.method,
        code: content,
        tenant: tenant!,
      });
    } else {
      mod.code = content;
    }

    await repo.save(mod);
  }

  private async writeFrontendFile(
    tenantId: string,
    tenant: TenantRequest['tenant'],
    relative: string,
    content: string,
  ): Promise<void> {
    const pkgName = this.packageNameFromPath(relative);
    if (!pkgName) {
      throw new AppError('Invalid frontend path. Expected frontend/<package>.jsx', 400);
    }

    const repo = this.dataSource.getRepository(UIPackage);
    const existing = await repo.find({
      where: { tenant: { id: tenantId }, name: pkgName },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    let pkg = existing[0];
    if (!pkg) {
      pkg = repo.create({
        tenant: tenant!,
        name: pkgName,
        version: 'latest',
        codeBlob: content,
        dependencies: [],
      });
    } else {
      pkg.codeBlob = content;
      pkg.version = pkg.version || 'latest';
    }

    await repo.save(pkg);
  }

  private async listBackendEntries(tenantId: string, relative: string): Promise<[string, EntryType][]> {
    const repo = this.dataSource.getRepository(ModuleEntity);
    const modules = await repo.find({
      where: { tenant: { id: tenantId } },
      select: ['routePath', 'method'],
    });
    const parentSegments = relative.split('/').filter(Boolean);
    const entries = new Map<string, EntryType>();

    for (const mod of modules) {
      const segments = this.routeSegments(mod.routePath);
      if (!this.startsWithSegments(segments, parentSegments)) {
        continue;
      }
      if (segments.length === parentSegments.length) {
        entries.set(`${mod.method}.js`, 'FILE');
      } else if (segments.length > parentSegments.length) {
        entries.set(segments[parentSegments.length], 'DIR');
      }
    }

    return Array.from(entries.entries());
  }

  private async listFrontendEntries(tenantId: string, relative: string): Promise<[string, EntryType][]> {
    const packages = await this.getLatestPackages(tenantId);
    const parentSegments = relative.split('/').filter(Boolean);
    const entries = new Map<string, EntryType>();

    for (const pkg of packages.values()) {
      const segments = pkg.name.split('/');
      if (!this.startsWithSegments(segments, parentSegments)) {
        continue;
      }
      if (segments.length === parentSegments.length + 1) {
        entries.set(`${segments[segments.length - 1]}.jsx`, 'FILE');
      } else if (segments.length > parentSegments.length + 1) {
        entries.set(segments[parentSegments.length], 'DIR');
      }
    }

    return Array.from(entries.entries());
  }

  private parseBackendFile(relative: string): { routePath: string; method: HttpMethod } | null {
    const normalized = path.posix.normalize(relative);
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length) {
      return null;
    }
    const fileName = parts[parts.length - 1];
    if (!fileName.toLowerCase().endsWith('.js')) {
      return null;
    }
    const method = fileName.substring(0, fileName.length - 3).toUpperCase();
    if (!Object.values(HttpMethod).includes(method as HttpMethod)) {
      return null;
    }

    const routeSegments = parts.slice(0, -1);
    const routePath = '/' + routeSegments.join('/');
    return { routePath, method: method as HttpMethod };
  }

  private packageNameFromPath(relative: string): string | null {
    const normalized = path.posix.normalize(relative);
    if (!normalized.toLowerCase().endsWith('.jsx')) {
      return null;
    }
    const withoutExt = normalized.slice(0, -4);
    const segments = withoutExt.split('/').filter(Boolean);
    if (!segments.length) {
      return null;
    }
    return segments.join('/');
  }

  private startsWithSegments(full: string[], prefix: string[]): boolean {
    if (prefix.length > full.length) {
      return false;
    }
    return prefix.every((seg, idx) => full[idx] === seg);
  }

  private routeSegments(routePath: string): string[] {
    return routePath.split('/').filter(Boolean);
  }

  private moduleTimes(modules: Pick<ModuleEntity, 'createdAt' | 'updatedAt'>[]): { ctime: number; mtime: number } {
    if (!modules.length) {
      const now = Date.now();
      return { ctime: now, mtime: now };
    }
    let ctime = modules[0].createdAt.getTime();
    let mtime = modules[0].updatedAt.getTime();
    for (const mod of modules) {
      ctime = Math.min(ctime, mod.createdAt.getTime());
      mtime = Math.max(mtime, mod.updatedAt.getTime());
    }
    return { ctime, mtime };
  }

  private packageTimes(packages: Pick<UIPackage, 'createdAt' | 'updatedAt'>[]): { ctime: number; mtime: number } {
    if (!packages.length) {
      const now = Date.now();
      return { ctime: now, mtime: now };
    }
    let ctime = packages[0].createdAt.getTime();
    let mtime = packages[0].updatedAt.getTime();
    for (const pkg of packages) {
      ctime = Math.min(ctime, pkg.createdAt.getTime());
      mtime = Math.max(mtime, pkg.updatedAt.getTime());
    }
    return { ctime, mtime };
  }

  private async getLatestPackages(tenantId: string): Promise<Map<string, UIPackage>> {
    const repo = this.dataSource.getRepository(UIPackage);
    const records = await repo.find({
      where: { tenant: { id: tenantId } },
      order: { createdAt: 'DESC' },
    });
    const latest = new Map<string, UIPackage>();
    for (const pkg of records) {
      if (!latest.has(pkg.name)) {
        latest.set(pkg.name, pkg);
      }
    }
    return latest;
  }
}

```

## src/app/controllers/RegistryController.ts

```ts
import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { UIPackage } from '../../entities/UIEntities';
import { TenantRequest } from '../../types/RequestContext';

export class RegistryController {
  constructor(private readonly dataSource: DataSource) {}

  resolve = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.tenant) {
        throw new AppError('Tenant required', 400);
      }

      const { name, version } = req.params;
      if (!name) {
        return res.status(400).json({ error: 'Package name required' });
      }

      const pkgRepo = this.dataSource.getRepository(UIPackage);
      let pkg: UIPackage | null = null;

      if (!version || version === 'latest') {
        const latest = await pkgRepo.find({
          where: { tenant: { id: req.tenant.id }, name },
          order: { createdAt: 'DESC' },
          take: 1,
        });
        pkg = latest[0] ?? null;
      } else {
        pkg = await pkgRepo.findOne({
          where: { tenant: { id: req.tenant.id }, name, version },
        });
      }

      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      return res.json({
        name: pkg.name,
        version: pkg.version,
        source: pkg.codeBlob,
        dependencies: pkg.dependencies ?? [],
      });
    } catch (error) {
      next(error);
    }
  };
}

```

## src/app/middleware/AuthGuard.ts

```ts
import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { CryptoService } from '../../core/security/CryptoService';
import { Account } from '../../entities/Account';
import { TenantRequest } from '../../types/RequestContext';

export interface AuthGuardOptions {
  publicPaths?: RegExp[];
}

export const AuthGuard =
  (dataSource: DataSource, cryptoService: CryptoService, options?: AuthGuardOptions) =>
  async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      if (options?.publicPaths?.some((pattern) => pattern.test(req.path))) {
        return next();
      }

      if (!req.tenant) {
        throw new AppError('Tenant context missing', 400);
      }

      const header = req.headers['authorization'];
      if (!header || !header.toLowerCase().startsWith('bearer ')) {
        return res.status(401).json({ error: 'Authorization header missing' });
      }

      const token = header.substring(7);
      const payload = cryptoService.verifyToken(token);
      if (!payload || payload.tenantId !== req.tenant.id) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      const accountRepo = dataSource.getRepository(Account);
      const account = await accountRepo.findOne({
        where: { id: payload.sub },
        relations: ['tenant'],
      });

      if (!account || account.tenant.id !== req.tenant.id) {
        return res.status(403).json({ error: 'Account not part of tenant' });
      }

      req.account = account;
      req.tokenPayload = payload;
      next();
    } catch (error) {
      next(error);
    }
  };

```

## src/app/middleware/ContextMiddleware.ts

```ts
import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { Tenant } from '../../entities/Tenant';
import { TenantRequest } from '../../types/RequestContext';

export const ContextMiddleware =
  (dataSource: DataSource) => async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const hostname = (req.hostname || '').toLowerCase();
      if (!hostname) {
        throw new AppError('Hostname required to resolve tenant', 400);
      }

      const tenantRepo = dataSource.getRepository(Tenant);
      const tenant = await tenantRepo.findOne({ where: { hostname } });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      if (tenant.isSuspended) {
        return res.status(403).json({ error: 'Tenant suspended' });
      }

      if (!tenant.resourceConfig) {
        tenant.resourceConfig = { memory: 512, timeout: 5_000 };
      }

      req.tenant = tenant;
      res.locals.tenantStage = tenant.stage;
      next();
    } catch (error) {
      next(error);
    }
  };

```

## src/app/middleware/TenantResolver.ts

```ts
import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { Tenant } from '../../entities/Tenant';
import { TenantRequest } from '../../types/RequestContext';

export const TenantResolver =
  (dataSource: DataSource) => async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const hostname = (req.hostname || '').toLowerCase();
      if (!hostname) {
        throw new AppError('Hostname required to resolve tenant', 400);
      }

      const tenantRepo = dataSource.getRepository(Tenant);
      const tenant = await tenantRepo.findOne({ where: { hostname } });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      if (tenant.isSuspended) {
        return res.status(403).json({ error: 'Tenant suspended' });
      }

      req.tenant = tenant;
      next();
    } catch (error) {
      next(error);
    }
  };

```

## src/common/AppError.ts

```ts
export class AppError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

```

## src/core/datasource.ts

```ts
import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Tenant } from '../entities/Tenant';
import { Account } from '../entities/Account';
import { Secret } from '../entities/Secret';
import { ModuleEntity } from '../entities/Module';
import { UIPackage } from '../entities/UIEntities';

const connectionOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  synchronize: true,
  logging: process.env.DB_LOGGING === 'true',
  entities: [Tenant, Account, Secret, ModuleEntity, UIPackage],
  subscribers: [],
  migrations: [],
};

export const AppDataSource = new DataSource(connectionOptions);

export const initializeDataSource = async (): Promise<DataSource> => {
  if (AppDataSource.isInitialized) {
    return AppDataSource;
  }

  try {
    return await AppDataSource.initialize();
  } catch (error) {
    // Avoid leaking credentials and keep logs minimal for production readiness
    console.error('Failed to initialize database connection:', (error as Error).message);
    throw error;
  }
};

```

## src/core/resilience/CircuitBreaker.ts

```ts
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private nextAttempt = Date.now();

  constructor(options?: CircuitBreakerOptions) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.cooldownMs = options?.cooldownMs ?? 60_000;
  }

  getState(): CircuitState {
    return this.state;
  }

  async fire<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is open; calls temporarily blocked');
      }
      this.state = CircuitState.HALF_OPEN;
    }

    try {
      const result = await action();
      this.reset();
      return result;
    } catch (error) {
      this.failureCount += 1;
      if (this.failureCount >= this.failureThreshold) {
        this.trip();
      }
      throw error;
    }
  }

  private reset(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
    this.nextAttempt = Date.now();
  }

  private trip(): void {
    this.state = CircuitState.OPEN;
    this.nextAttempt = Date.now() + this.cooldownMs;
  }
}

```

## src/core/security/CryptoService.ts

```ts
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

export interface EncryptedPayload {
  iv: string;
  authTag: string;
  encryptedValue: string;
}

export interface TokenPayload {
  sub: string;
  tenantId: string;
  role?: string;
  exp: number;
  metadata?: Record<string, unknown>;
}

export class CryptoService {
  private readonly encryptionKey: Buffer;
  private readonly tokenSecret: Buffer;

  constructor(encryptionKey: Buffer, tokenSecret: Buffer) {
    if (encryptionKey.length !== 32) {
      throw new Error('Encryption key must be 32 bytes for AES-256-GCM');
    }
    this.encryptionKey = encryptionKey;
    this.tokenSecret = tokenSecret;
  }

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
  }

  async comparePassword(password: string, storedHash: string): Promise<boolean> {
    const [saltHex, hashHex] = storedHash.split(':');
    if (!saltHex || !hashHex) {
      return false;
    }

    const salt = Buffer.from(saltHex, 'hex');
    const expectedHash = Buffer.from(hashHex, 'hex');
    const derivedKey = (await scryptAsync(password, salt, expectedHash.length)) as Buffer;

    if (expectedHash.length !== derivedKey.length) {
      return false;
    }

    return timingSafeEqual(expectedHash, derivedKey);
  }

  encryptSecret(value: string): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      encryptedValue: encrypted.toString('hex'),
    };
  }

  decryptSecret(payload: EncryptedPayload): string {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(payload.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.encryptedValue, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  // Backwards-compatible aliases (avoid breaking callers)
  encrypt(value: string): EncryptedPayload {
    return this.encryptSecret(value);
  }

  decrypt(payload: EncryptedPayload): string {
    return this.decryptSecret(payload);
  }

  signToken(payload: Omit<TokenPayload, 'exp'>, ttlSeconds: number): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const fullPayload: TokenPayload = { ...payload, exp };
    const serialized = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const signature = createHmac('sha256', this.tokenSecret).update(serialized).digest();
    return `${serialized}.${signature.toString('base64url')}`;
  }

  verifyToken(token: string): TokenPayload | null {
    const [payloadPart, signaturePart] = token.split('.');
    if (!payloadPart || !signaturePart) {
      return null;
    }

    const expected = createHmac('sha256', this.tokenSecret).update(payloadPart).digest();
    const received = Buffer.from(signaturePart, 'base64url');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as TokenPayload;
      if (parsed.exp <= Math.floor(Date.now() / 1000)) {
        return null;
      }
      return parsed;
    } catch (error) {
      return null;
    }
  }
}

```

## src/engine/AdapterFactory.ts

```ts
import https from 'https';
import { Pool as PgPool } from 'pg';
import { createPool as createMySqlPool } from 'mysql2/promise';
import { ConnectionPool } from 'mssql';
import Redis from 'ioredis';
import { Kafka, Producer } from 'kafkajs';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DataSource } from 'typeorm';
import { CircuitBreaker } from '../core/resilience/CircuitBreaker';
import { CryptoService } from '../core/security/CryptoService';
import { Tenant } from '../entities/Tenant';
import { Secret } from '../entities/Secret';
import { CompilerAdapter } from './adapters/CompilerAdapter';

type AsyncFactory<T> = (envKey: string) => Promise<T>;

export interface PostgresAdapter {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
}

export interface MysqlAdapter {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
}

export interface MssqlAdapter {
  query: (sql: string) => Promise<unknown[]>;
}

export interface RedisAdapter {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds?: number) => Promise<'OK'>;
  del: (key: string) => Promise<number>;
  publish: (channel: string, message: string) => Promise<number>;
}

export interface KafkaAdapter {
  publish: (topic: string, messages: { key?: string; value: string }[]) => Promise<void>;
}

export interface S3Adapter {
  putObject: (params: { bucket: string; key: string; body: Buffer | string }) => Promise<void>;
  getSignedUrl: (params: { bucket: string; key: string; expiresIn?: number }) => Promise<string>;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | Record<string, unknown>;
  timeoutMs?: number;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
}

export interface SandboxAdapters {
  postgres: AsyncFactory<PostgresAdapter>;
  mysql: AsyncFactory<MysqlAdapter>;
  mssql: AsyncFactory<MssqlAdapter>;
  redis: AsyncFactory<RedisAdapter>;
  kafka: AsyncFactory<KafkaAdapter>;
  s3: AsyncFactory<S3Adapter>;
  http?: {
    request: (url: string, options?: HttpRequestOptions) => Promise<HttpResponse>;
  };
  compiler?: CompilerAdapter;
}

export class AdapterFactory {
  private pgPools: Map<string, PgPool> = new Map();
  private mysqlPools: Map<string, ReturnType<typeof createMySqlPool>> = new Map();
  private mssqlPools: Map<string, ConnectionPool> = new Map();
  private redisClients: Map<string, Redis> = new Map();
  private kafkaProducers: Map<string, Producer> = new Map();
  private s3Clients: Map<string, S3Client> = new Map();

  private breakers: Map<string, CircuitBreaker> = new Map();
  private compilerAdapter: CompilerAdapter;

  constructor(private readonly dataSource: DataSource, private readonly cryptoService: CryptoService) {
    this.compilerAdapter = new CompilerAdapter();
  }

  build(tenant: Tenant): SandboxAdapters {
    return {
      postgres: (envKey) => this.buildPostgres(tenant, envKey),
      mysql: (envKey) => this.buildMysql(tenant, envKey),
      mssql: (envKey) => this.buildMssql(tenant, envKey),
      redis: (envKey) => this.buildRedis(tenant, envKey),
      kafka: (envKey) => this.buildKafka(tenant, envKey),
      s3: (envKey) => this.buildS3(tenant, envKey),
      http: this.buildHttpAdapter(tenant),
      compiler: this.compilerAdapter,
    };
  }

  private breakerFor(key: string): CircuitBreaker {
    let br = this.breakers.get(key);
    if (!br) {
      br = new CircuitBreaker();
      this.breakers.set(key, br);
    }
    return br;
  }

  private async getSecretValue(tenant: Tenant, keyName: string): Promise<string> {
    const repo = this.dataSource.getRepository(Secret);
    const secret = await repo.findOne({ where: { tenant: { id: tenant.id }, keyName } });
    if (!secret) {
      throw new Error(`Secret ${keyName} not found for tenant`);
    }
    return this.cryptoService.decryptSecret({
      encryptedValue: secret.encryptedValue,
      authTag: secret.authTag,
      iv: secret.iv,
    });
  }

  private async buildPostgres(tenant: Tenant, envKey: string): Promise<PostgresAdapter> {
    const cacheKey = `${tenant.id}:pg:${envKey}`;
    if (!this.pgPools.has(cacheKey)) {
      const connString = await this.getSecretValue(tenant, envKey);
      this.pgPools.set(cacheKey, new PgPool({ connectionString: connString }));
    }
    const pool = this.pgPools.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      query: async (sql: string, params?: unknown[]) =>
        breaker.fire(async () => {
          const client = await pool.connect();
          try {
            const result = await client.query(sql, params as unknown[] | undefined);
            return result.rows;
          } finally {
            client.release();
          }
        }),
    };
  }

  private async buildMysql(tenant: Tenant, envKey: string): Promise<MysqlAdapter> {
    const cacheKey = `${tenant.id}:mysql:${envKey}`;
    if (!this.mysqlPools.has(cacheKey)) {
      const connString = await this.getSecretValue(tenant, envKey);
      this.mysqlPools.set(cacheKey, createMySqlPool({ uri: connString }));
    }
    const pool = this.mysqlPools.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      query: async (sql: string, params?: unknown[]) =>
        breaker.fire(async () => {
          const [rows] = await pool.query(sql, params as unknown[] | undefined);
          return Array.isArray(rows) ? rows : [];
        }),
    };
  }

  private async buildMssql(tenant: Tenant, envKey: string): Promise<MssqlAdapter> {
    const cacheKey = `${tenant.id}:mssql:${envKey}`;
    if (!this.mssqlPools.has(cacheKey)) {
      const connString = await this.getSecretValue(tenant, envKey);
      const pool = new ConnectionPool(connString);
      await pool.connect();
      this.mssqlPools.set(cacheKey, pool);
    }
    const pool = this.mssqlPools.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      query: async (sql: string) =>
        breaker.fire(async () => {
          const result = await pool.request().query(sql);
          return result.recordset;
        }),
    };
  }

  private async buildRedis(tenant: Tenant, envKey: string): Promise<RedisAdapter> {
    const cacheKey = `${tenant.id}:redis:${envKey}`;
    if (!this.redisClients.has(cacheKey)) {
      const connString = await this.getSecretValue(tenant, envKey);
      this.redisClients.set(cacheKey, new Redis(connString));
    }
    const client = this.redisClients.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      get: async (key: string) => breaker.fire(async () => client.get(key)),
      set: async (key: string, value: string, ttlSeconds?: number) =>
        breaker.fire(async () => {
          if (ttlSeconds) {
            return client.set(key, value, 'EX', ttlSeconds);
          }
          return client.set(key, value);
        }),
      del: async (key: string) => breaker.fire(async () => client.del(key)),
      publish: async (channel: string, message: string) =>
        breaker.fire(async () => client.publish(channel, message)),
    };
  }

  private async buildKafka(tenant: Tenant, envKey: string): Promise<KafkaAdapter> {
    const cacheKey = `${tenant.id}:kafka:${envKey}`;
    if (!this.kafkaProducers.has(cacheKey)) {
      const secretVal = await this.getSecretValue(tenant, envKey);
      let brokers: string[] = [];
      try {
        const parsed = JSON.parse(secretVal);
        brokers = parsed.brokers || [];
      } catch {
        brokers = secretVal.split(',').map((s) => s.trim());
      }
      const kafka = new Kafka({ clientId: `tenant-${tenant.id}`, brokers });
      const producer = kafka.producer();
      await producer.connect();
      this.kafkaProducers.set(cacheKey, producer);
    }
    const producer = this.kafkaProducers.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      publish: async (topic: string, messages: { key?: string; value: string }[]) =>
        breaker.fire(async () => {
          await producer.send({
            topic,
            messages: messages.map((m) => ({ key: m.key, value: m.value })),
          });
        }),
    };
  }

  private async buildS3(tenant: Tenant, envKey: string): Promise<S3Adapter> {
    const cacheKey = `${tenant.id}:s3:${envKey}`;
    if (!this.s3Clients.has(cacheKey)) {
      const secretVal = await this.getSecretValue(tenant, envKey);
      let cfg: {
        endpoint?: string;
        region?: string;
        accessKeyId?: string;
        secretAccessKey?: string;
        forcePathStyle?: boolean;
      } = {};
      try {
        cfg = JSON.parse(secretVal);
      } catch {
        cfg = { endpoint: undefined, region: 'us-east-1' };
      }
      const client = new S3Client({
        region: cfg.region || 'us-east-1',
        endpoint: cfg.endpoint,
        forcePathStyle: cfg.forcePathStyle ?? !!cfg.endpoint,
        credentials:
          cfg.accessKeyId && cfg.secretAccessKey
            ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
            : undefined,
      });
      this.s3Clients.set(cacheKey, client);
    }
    const client = this.s3Clients.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      putObject: async (params: { bucket: string; key: string; body: Buffer | string }) =>
        breaker.fire(async () => {
          await client.send(
            new PutObjectCommand({
              Bucket: params.bucket,
              Key: params.key,
              Body: params.body,
            }),
          );
        }),
      getSignedUrl: async (params: { bucket: string; key: string; expiresIn?: number }) =>
        breaker.fire(async () => {
          const command = new GetObjectCommand({ Bucket: params.bucket, Key: params.key });
          return getSignedUrl(client, command, { expiresIn: params.expiresIn ?? 900 });
        }),
    };
  }

  private buildHttpAdapter(_tenant: Tenant) {
    const cacheKey = 'http-default';
    const breaker = this.breakerFor(cacheKey);
    return {
      request: async (url: string, options?: HttpRequestOptions): Promise<HttpResponse> =>
        breaker.fire(
          () =>
            new Promise<HttpResponse>((resolve, reject) => {
              const parsedUrl = new URL(url);
              const headers: Record<string, string> = { ...(options?.headers ?? {}) };

              const body =
                options?.body && typeof options.body === 'object' && !(options.body instanceof Buffer)
                  ? JSON.stringify(options.body)
                  : (options?.body as string | Buffer | undefined);

              if (body && !headers['content-length']) {
                headers['content-length'] = Buffer.byteLength(body).toString();
              }

              if (body && !headers['content-type'] && typeof options?.body === 'object') {
                headers['content-type'] = 'application/json';
              }

              const requestOptions: https.RequestOptions = {
                method: options?.method ?? 'GET',
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 443,
                path: `${parsedUrl.pathname}${parsedUrl.search}`,
                headers,
              };

              const req = https.request(requestOptions, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                  resolve({
                    statusCode: res.statusCode ?? 0,
                    headers: res.headers as Record<string, string | string[]>,
                    body: Buffer.concat(chunks).toString('utf8'),
                  });
                });
              });

              req.on('error', reject);

              req.setTimeout(options?.timeoutMs ?? 5000, () => {
                req.destroy(new Error('HTTP request timed out'));
              });

              if (body) {
                req.write(body);
              }
              req.end();
            }),
        ),
    };
  }
}

```

## src/engine/SandboxRunner.ts

```ts
import vm from 'vm';
import { SandboxAdapters } from './AdapterFactory';
import { AccountRole } from '../entities/Account';
import { TenantStage } from '../entities/Tenant';
import { AppError } from '../common/AppError';

export interface SandboxRequestContext {
  path: string;
  method: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  params: Record<string, string>;
  tenant: {
    id: string;
    hostname: string;
    stage: TenantStage;
    resourceConfig: {
      memory: number;
      timeout: number;
    };
  };
  account?: {
    id: string;
    email: string;
    role: AccountRole;
  };
}

export interface SandboxContext {
  request: SandboxRequestContext;
  adapters: SandboxAdapters;
}

export interface SandboxResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export class SandboxRunner {
  constructor(private readonly maxTimeoutMs = 30_000) {}

  async run(code: string, context: SandboxContext): Promise<SandboxResult> {
    const safeRequest = this.sanitizeRequest(context.request);
    const effectiveTimeout = this.resolveTimeout(safeRequest.tenant.stage, safeRequest.tenant.resourceConfig);

    const frozenAdapters: SandboxAdapters = context.adapters;
    const frozenRequest = Object.freeze({ ...safeRequest }) as SandboxRequestContext;

    const sandboxGlobals: Record<string, unknown> = {
      request: frozenRequest,
      adapters: frozenAdapters,
      console,
    };
    Object.freeze(sandboxGlobals);

    const vmContext = vm.createContext(sandboxGlobals);
    const script = new vm.Script(
      `
        "use strict";
        const module = { exports: {} };
        const exports = module.exports;
        ${code}
        module.exports;
      `,
      { filename: 'tenant-module.js' },
    );

    let exported: unknown;
    try {
      exported = script.runInContext(vmContext, { timeout: effectiveTimeout });
    } catch (error) {
      throw new AppError(`Sandbox execution failed: ${(error as Error).message}`, 500);
    }

    const handler = this.resolveHandler(exported);
    if (typeof handler !== 'function') {
      throw new AppError('Module must export a function', 400);
    }

    try {
      const result = await Promise.race([
        Promise.resolve(handler(frozenRequest, frozenAdapters)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Execution timed out')), effectiveTimeout),
        ),
      ]);

      if (result && typeof result === 'object') {
        const typed = result as SandboxResult;
        return {
          statusCode: typed.statusCode ?? 200,
          headers: typed.headers,
          body: typed.body,
        };
      }

      return { statusCode: 200, body: result };
    } catch (error) {
      throw new AppError(`Module error: ${(error as Error).message}`, 500);
    }
  }

  private resolveHandler(exported: unknown): unknown {
    if (typeof exported === 'function') {
      return exported;
    }

    if (exported && typeof exported === 'object' && (exported as Record<string, unknown>).default) {
      return (exported as Record<string, unknown>).default;
    }

    return null;
  }

  private sanitizeRequest(request: SandboxRequestContext): SandboxRequestContext {
    return {
      path: request.path,
      method: request.method,
      headers: { ...request.headers },
      query: { ...request.query },
      body: request.body,
      params: { ...(request.params ?? {}) },
      tenant: {
        id: request.tenant.id,
        hostname: request.tenant.hostname,
        stage: request.tenant.stage,
        resourceConfig: { ...request.tenant.resourceConfig },
      },
      account: request.account
        ? {
            id: request.account.id,
            email: request.account.email,
            role: request.account.role,
          }
        : undefined,
    };
  }

  private resolveTimeout(stage: TenantStage, resourceConfig: { memory: number; timeout: number }): number {
    const stageCeiling =
      stage === TenantStage.DEV ? 30_000 : stage === TenantStage.PROD ? 5_000 : 15_000;
    const configured = resourceConfig?.timeout ?? stageCeiling;
    return Math.min(configured, stageCeiling, this.maxTimeoutMs);
  }
}

```

## src/engine/adapters/CompilerAdapter.ts

```ts
export class CompilerAdapter {
  async compile(filename: string, source: string): Promise<string> {
    const strippedImports = source.replace(/^\s*import[^;]*;?\s*$/gm, '').trim();
    const jsxTransformed = this.transformJSX(strippedImports);
    const wrapped = this.wrapAsModule(filename, jsxTransformed);
    return wrapped;
  }

  private transformJSX(code: string): string {
    // Very simplified JSX to React.createElement transformation:
    // - Self-closing: <Tag attr="x" /> -> React.createElement('Tag', { attr: "x" })
    // - With children: <div>text</div> -> React.createElement('div', null, "text")
    // This is intentionally basic to avoid external tooling.
    let output = code;

    // Convert self-closing tags
    output = output.replace(
      /<([A-Za-z0-9_]+)([^>]*)\/>/g,
      (_match, tag, attrs) => `React.createElement('${tag}', ${this.parseProps(attrs)})`,
    );

    // Convert opening/closing tags with inner text (no nested JSX in this naive pass)
    output = output.replace(
      /<([A-Za-z0-9_]+)([^>]*)>([^<]*)<\/\1>/g,
      (_match, tag, attrs, inner) =>
        `React.createElement('${tag}', ${this.parseProps(attrs)}, ${this.stringifyLiteral(inner)})`,
    );

    return output;
  }

  private parseProps(rawAttrs: string): string {
    if (!rawAttrs || !rawAttrs.trim()) {
      return 'null';
    }
    const props: string[] = [];
    const attrRegex = /([A-Za-z0-9_:-]+)\s*=\s*"([^"]*)"/g;
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(rawAttrs)) !== null) {
      const [, key, value] = match;
      props.push(`'${key}': ${this.stringifyLiteral(value)}`);
    }
    if (props.length === 0) {
      return 'null';
    }
    return `{ ${props.join(', ')} }`;
  }

  private stringifyLiteral(value: string): string {
    const escaped = value.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    return '`' + escaped + '`';
  }

  private wrapAsModule(id: string, body: string): string {
    return `
define('${id}', [], function(require, exports, module) {
  ${body}
});
`.trim();
  }
}

```

## src/entities/Account.ts

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './Tenant';

export enum AccountRole {
  ADMIN = 'ADMIN',
  DEVELOPER = 'DEVELOPER',
  AUDITOR = 'AUDITOR',
}

@Entity({ name: 'accounts' })
@Unique(['email', 'tenant'])
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  email!: string;

  @Column()
  passwordHash!: string;

  @Column({ type: 'enum', enum: AccountRole, default: AccountRole.DEVELOPER })
  role!: AccountRole;

  @ManyToOne(() => Tenant, (tenant) => tenant.accounts, { onDelete: 'CASCADE' })
  tenant!: Tenant;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

```

## src/entities/Module.ts

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './Tenant';

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

@Entity({ name: 'modules' })
@Index(['tenant', 'routePath', 'method'], { unique: true })
export class ModuleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  routePath!: string;

  @Column({ type: 'enum', enum: HttpMethod, default: HttpMethod.GET })
  method!: HttpMethod;

  @Column({ type: 'text' })
  code!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.modules, { onDelete: 'CASCADE' })
  tenant!: Tenant;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

```

## src/entities/Secret.ts

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './Tenant';

@Entity({ name: 'secrets' })
@Unique(['keyName', 'tenant'])
export class Secret {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  keyName!: string;

  @Column({ type: 'text' })
  encryptedValue!: string;

  @Column()
  iv!: string;

  @Column()
  authTag!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.secrets, { onDelete: 'CASCADE' })
  tenant!: Tenant;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

```

## src/entities/Tenant.ts

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Account } from './Account';
import { Secret } from './Secret';
import { ModuleEntity } from './Module';

export enum TenantStage {
  DEV = 'DEV',
  STAGING = 'STAGING',
  PROD = 'PROD',
}

@Entity({ name: 'tenants' })
@Unique(['hostname'])
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  hostname!: string;

  @Column({ type: 'enum', enum: TenantStage, default: TenantStage.DEV })
  stage!: TenantStage;

  @Column({ type: 'jsonb', default: () => "'{\"memory\":512,\"timeout\":5000}'" })
  resourceConfig!: {
    memory: number;
    timeout: number;
  };

  @Column({ default: false })
  isSuspended!: boolean;

  @OneToMany(() => Account, (account) => account.tenant, { cascade: true })
  accounts!: Account[];

  @OneToMany(() => Secret, (secret) => secret.tenant, { cascade: true })
  secrets!: Secret[];

  @OneToMany(() => ModuleEntity, (module) => module.tenant, { cascade: true })
  modules!: ModuleEntity[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

```

## src/entities/UIEntities.ts

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './Tenant';

@Entity({ name: 'ui_packages' })
@Index(['tenant', 'name', 'version'], { unique: true })
export class UIPackage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.id, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column()
  name!: string;

  @Column()
  version!: string;

  @Column({ name: 'code_blob', type: 'text' })
  codeBlob!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  dependencies!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

```

## src/seed-packages.ts

```ts
import 'dotenv/config';
import 'reflect-metadata';
import { AppDataSource, initializeDataSource } from './core/datasource';
import { Tenant } from './entities/Tenant';
import { UIPackage } from './entities/UIEntities';

const themePackage = {
  name: '@core/theme',
  version: '1.0.0',
  dependencies: [] as string[],
  code: `
    const palette = { primary: '#2563eb', surface: '#0f172a', text: '#e2e8f0' };
    module.exports = { colors: palette };
  `.trim(),
};

const dashboardPackage = {
  name: '@app/dashboard',
  version: '1.0.0',
  dependencies: ['@core/theme'],
  code: `
    const theme = require('@core/theme');

    function App() {
      return React.createElement(
        'div',
        { style: { color: theme.colors.primary, fontFamily: 'Inter, system-ui, sans-serif', padding: '24px' } },
        React.createElement('h1', null, 'Hello Dashboard'),
        React.createElement('p', null, 'Server-driven micro-frontend mounted from the registry.')
      );
    }

    module.exports = {
      mount: function(container) {
        if (!container) {
          throw new Error('Container not found');
        }
        if (ReactDOM && ReactDOM.createRoot) {
          ReactDOM.createRoot(container).render(React.createElement(App));
        } else {
          ReactDOM.render(React.createElement(App), container);
        }
      }
    };
  `.trim(),
};

const packages = [themePackage, dashboardPackage];

const seedPackages = async () => {
  await initializeDataSource();
  const tenantRepo = AppDataSource.getRepository(Tenant);
  const pkgRepo = AppDataSource.getRepository(UIPackage);

  const tenants = await tenantRepo.find();
  if (!tenants.length) {
    throw new Error('No tenants found. Seed tenants first.');
  }

  for (const tenant of tenants) {
    for (const pkg of packages) {
      await upsertPackage(pkgRepo, tenant.id, pkg);
    }
  }

  await AppDataSource.destroy();
  console.log('Package registry seeded.');
};

const upsertPackage = async (
  repo: ReturnType<typeof AppDataSource.getRepository<UIPackage>>,
  tenantId: string,
  pkg: { name: string; version: string; code: string; dependencies: string[] },
) => {
  let existing = await repo.findOne({
    where: { tenant: { id: tenantId }, name: pkg.name, version: pkg.version },
  });

  if (!existing) {
    existing = repo.create({
      tenant: { id: tenantId } as Tenant,
      name: pkg.name,
      version: pkg.version,
      codeBlob: pkg.code,
      dependencies: pkg.dependencies,
    });
  } else {
    existing.codeBlob = pkg.code;
    existing.dependencies = pkg.dependencies;
  }

  await repo.save(existing);
  console.log(`Upserted package ${pkg.name}@${pkg.version} for tenant ${tenantId}`);
};

seedPackages().catch((err) => {
  console.error('Failed to seed packages:', err);
  process.exit(1);
});

```

## src/seed.ts

```ts
import 'dotenv/config';
import 'reflect-metadata';
import { AppDataSource, initializeDataSource } from './core/datasource';
import { CryptoService } from './core/security/CryptoService';
import { Tenant, TenantStage } from './entities/Tenant';
import { Account, AccountRole } from './entities/Account';
import { Secret } from './entities/Secret';
import { ModuleEntity, HttpMethod } from './entities/Module';

const getKeyFromEnv = (envName: string, expectedBytes: number): Buffer => {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`${envName} is required`);
  }

  const isHex = /^[a-fA-F0-9]+$/.test(raw) && raw.length === expectedBytes * 2;
  const buffer = isHex ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buffer.length !== expectedBytes) {
    throw new Error(`${envName} must decode to ${expectedBytes} bytes`);
  }
  return buffer;
};

const cryptoService = new CryptoService(getKeyFromEnv('ENCRYPTION_KEY', 32), getKeyFromEnv('TOKEN_SECRET', 32));

const seedTenants = [
  {
    hostname: 'dev.internal.local',
    stage: TenantStage.DEV,
    resourceConfig: { memory: 512, timeout: 30000 },
    adminEmail: 'admin@dev.internal.local',
    secrets: {
      PG_URL: 'postgres://postgres:postgres@localhost:5432/idpcore',
      API_KEY: 'dev-api-key',
    },
  },
  {
    hostname: 'prod.internal.local',
    stage: TenantStage.PROD,
    resourceConfig: { memory: 1024, timeout: 5000 },
    adminEmail: 'admin@prod.internal.local',
    secrets: {
      PG_URL: 'postgres://postgres:postgres@localhost:5432/idpcore',
      API_KEY: 'prod-api-key',
    },
  },
];

const bootstrapSeed = async () => {
  await initializeDataSource();

  for (const tenantSeed of seedTenants) {
    await seedTenant(tenantSeed);
  }

  await AppDataSource.destroy();
  console.log('Seeding completed');
};

const seedTenant = async (seed: (typeof seedTenants)[number]) => {
  const tenantRepo = AppDataSource.getRepository(Tenant);
  const accountRepo = AppDataSource.getRepository(Account);
  const secretRepo = AppDataSource.getRepository(Secret);
  const moduleRepo = AppDataSource.getRepository(ModuleEntity);

  let tenant = await tenantRepo.findOne({ where: { hostname: seed.hostname } });
  if (!tenant) {
    tenant = tenantRepo.create({
      hostname: seed.hostname,
      stage: seed.stage,
      resourceConfig: seed.resourceConfig,
      isSuspended: false,
    });
    await tenantRepo.save(tenant);
    console.log(`Created tenant ${seed.hostname}`);
  } else {
    tenant.stage = seed.stage;
    tenant.resourceConfig = seed.resourceConfig;
    tenant.isSuspended = false;
    await tenantRepo.save(tenant);
    console.log(`Updated tenant ${seed.hostname}`);
  }

  let admin = await accountRepo.findOne({ where: { email: seed.adminEmail, tenant: { id: tenant.id } } });
  if (!admin) {
    const passwordHash = await cryptoService.hashPassword('changeme');
    admin = accountRepo.create({
      email: seed.adminEmail,
      passwordHash,
      role: AccountRole.ADMIN,
      tenant,
    });
    await accountRepo.save(admin);
    console.log(`Created admin account ${seed.adminEmail}`);
  }

  for (const [keyName, value] of Object.entries(seed.secrets)) {
    let secret = await secretRepo.findOne({ where: { keyName, tenant: { id: tenant.id } } });
    const encrypted = cryptoService.encryptSecret(value);
    if (!secret) {
      secret = secretRepo.create({
        keyName,
        encryptedValue: encrypted.encryptedValue,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        tenant,
      });
    } else {
      secret.encryptedValue = encrypted.encryptedValue;
      secret.iv = encrypted.iv;
      secret.authTag = encrypted.authTag;
    }
    await secretRepo.save(secret);
  }
  console.log(`Stored secrets for ${seed.hostname}`);

  const sampleModule = await moduleRepo.findOne({
    where: { tenant: { id: tenant.id }, routePath: '/hello', method: HttpMethod.GET },
  });
  const helloCode = `
    module.exports = async function handler(req, adapters) {
      return {
        statusCode: 200,
        body: { message: 'Hello from ${seed.hostname}', stage: '${seed.stage}' }
      };
    };
  `;
  if (!sampleModule) {
    const mod = moduleRepo.create({
      routePath: '/hello',
      method: HttpMethod.GET,
      code: helloCode,
      tenant,
    });
    await moduleRepo.save(mod);
    console.log(`Created sample module for ${seed.hostname}`);
  }
};

bootstrapSeed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});

```

## src/server.ts

```ts
import 'dotenv/config';
import 'reflect-metadata';
import path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import { AppError } from './common/AppError';
import { initializeDataSource, AppDataSource } from './core/datasource';
import { CryptoService } from './core/security/CryptoService';
import { AdapterFactory } from './engine/AdapterFactory';
import { SandboxRunner } from './engine/SandboxRunner';
import { AuthController } from './app/controllers/AuthController';
import { Dispatcher } from './app/controllers/Dispatcher';
import { AuthGuard } from './app/middleware/AuthGuard';
import { ContextMiddleware } from './app/middleware/ContextMiddleware';
import { AdminController } from './app/controllers/AdminController';
import { TenantStage } from './entities/Tenant';
import { TenantRequest } from './types/RequestContext';
import { RegistryController } from './app/controllers/RegistryController';
import { FileSystemController } from './app/controllers/FileSystemController';

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const port = parseInt(process.env.PORT ?? '3000', 10);

const buildCryptoService = (): CryptoService => {
  const encryptionKey = getKeyFromEnv('ENCRYPTION_KEY', 32);
  const tokenSecret = getKeyFromEnv('TOKEN_SECRET', 32);
  return new CryptoService(encryptionKey, tokenSecret);
};

const getKeyFromEnv = (envName: string, expectedBytes: number): Buffer => {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`${envName} is required`);
  }

  const isHex = /^[a-fA-F0-9]+$/.test(raw) && raw.length === expectedBytes * 2;
  const buffer = isHex ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buffer.length !== expectedBytes) {
    throw new Error(`${envName} must decode to ${expectedBytes} bytes`);
  }
  return buffer;
};

const bootstrap = async () => {
  await initializeDataSource();
  const cryptoService = buildCryptoService();

  const adapterFactory = new AdapterFactory(AppDataSource, cryptoService);
  const sandboxRunner = new SandboxRunner(30_000);
  const authController = new AuthController(AppDataSource, cryptoService);
  const adminController = new AdminController(AppDataSource);
  const dispatcher = new Dispatcher(AppDataSource, adapterFactory, sandboxRunner);
  const registryController = new RegistryController(AppDataSource);
  const fileSystemController = new FileSystemController(AppDataSource);

  const contextMiddleware = ContextMiddleware(AppDataSource);
  const authGuard = AuthGuard(AppDataSource, cryptoService, {
    publicPaths: [/^\/$/, /^\/loader\.js$/, /^\/boot$/, /^\/favicon\.ico$/, /^\/login(?:\.html)?$/],
  });

  app.post('/admin/tenants', adminController.createTenant);
  app.post('/auth/register', contextMiddleware, authController.register);
  app.post('/auth/login', contextMiddleware, authController.login);
  app.get('/api/registry/:name/:version?', contextMiddleware, registryController.resolve);

  app.get('/sys/api/vfs/stat', contextMiddleware, authGuard, fileSystemController.stat);
  app.get('/sys/api/vfs/read', contextMiddleware, authGuard, fileSystemController.read);
  app.post('/sys/api/vfs/write', contextMiddleware, authGuard, fileSystemController.write);
  app.get('/sys/api/vfs/readdir', contextMiddleware, authGuard, fileSystemController.readdir);

  app.use('/extension', express.static(path.join(__dirname, '../idp-web-ext')));
  app.get('/ide', (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/ide.html'));
  });

  app.all('*', contextMiddleware, authGuard, dispatcher.handle);

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const tenantStage = (req as TenantRequest).tenant?.stage ?? res.locals?.tenantStage;
    const isAppError = err instanceof AppError;
    const status = isAppError ? err.status : 500;
    const payload: Record<string, unknown> = {
      error: err.message,
      ...(isAppError && (err as AppError).code ? { code: (err as AppError).code } : {}),
    };

    if (tenantStage === TenantStage.DEV) {
      payload.stack = err.stack;
    } else if (tenantStage === TenantStage.PROD && status >= 500) {
      payload.error = 'Internal server error';
    }

    if (!isAppError) {
      console.error('Unhandled error:', err);
    }

    return res.status(status).json(payload);
  });

  app.listen(port, () => {
    console.log(`FaaS runtime listening on port ${port}`);
  });
};

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

```

## src/types/RequestContext.ts

```ts
import { Request } from 'express';
import { Account } from '../entities/Account';
import { Tenant } from '../entities/Tenant';
import { TokenPayload } from '../core/security/CryptoService';

export interface TenantRequest extends Request {
  tenant?: Tenant;
  account?: Account;
  tokenPayload?: TokenPayload;
}

```

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "node",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}

```
