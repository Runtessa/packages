import vm from 'vm';
import path from 'path';
import { createRequire } from 'module';
import fs from 'fs';
import * as typeorm from 'typeorm';

const getNodeRequire = () => {
  const nonWebpack = (globalThis as any).__non_webpack_require__;
  if (typeof nonWebpack === 'function') return nonWebpack as (id: string) => any;
  return typeof require === 'function' ? require : null;
};

export type OrmModelSource = {
  path: string;
  code: string;
};

import { ensureJsExtension, findByBasename, findKeyInsensitive, normalizePath, resolveModule } from './orm-module-resolver';
import { collectOrmExports } from './orm-exports';

export const loadDynamicOrmEntities = (models: OrmModelSource[]) => {
  const rootRequire = (() => {
    const candidates: Array<(id: string) => any> = [];
    const nodeRequire = getNodeRequire();
    if (nodeRequire) {
      candidates.push((id: string) => nodeRequire(id));
    }
    const cwd = process.cwd();
    const roots = [cwd, path.resolve(cwd, '..'), path.resolve(cwd, '../..')];
    roots.forEach((root) => {
      try {
        const pkgPath = path.join(root, 'package.json');
        const req = createRequire(fs.existsSync(pkgPath) ? pkgPath : root + path.sep);
        candidates.push((id: string) => req(id));
      } catch {
        // ignore
      }
    });
    return (id: string) => {
      const loweredId = String(id).toLowerCase();
      if (loweredId === 'typeorm' || loweredId.startsWith('typeorm/')) {
        return typeorm;
      }
      for (const candidate of candidates) {
        try {
          return candidate(id);
        } catch {
          // try next candidate
        }
      }
      throw new Error(`External require not available: ${id}`);
    };
  })();

  try {
    rootRequire('reflect-metadata');
  } catch {
    // ignore
  }

  const moduleMap = new Map<string, string>();
  models.forEach((model) => {
    const normalized = ensureJsExtension(normalizePath(model.path));
    if (!normalized) return;
    moduleMap.set(normalized, model.code);
    const baseName = normalized.split('/').pop() || '';
    if (baseName && !moduleMap.has(baseName)) {
      moduleMap.set(baseName, model.code);
    }
    const baseNoExt = baseName.replace(/\.[^.]+$/, '');
    if (baseNoExt && !moduleMap.has(baseNoExt)) {
      moduleMap.set(baseNoExt, model.code);
    }
  });

  const cache = new Map<string, any>();

  const localRequire = (request: string, from: string) => {
    const rawRequest = String(request || '').replace(/\0/g, '').trim();
    const normalizedRequest = rawRequest.replace(/\.(ts|tsx)$/i, '.js');
    const lowered = normalizedRequest.toLowerCase();
    if (lowered === 'typeorm' || lowered.startsWith('typeorm/')) {
      return typeorm;
    }
    let resolved = resolveModule(normalizedRequest, from, moduleMap);
    if (!moduleMap.has(resolved)) {
      const fallback =
        findByBasename(normalizedRequest, moduleMap) ||
        findKeyInsensitive(normalizedRequest, moduleMap);
      if (fallback) {
        resolved = fallback;
      }
    }
    if (!moduleMap.has(resolved)) {
      const trimmed = normalizedRequest.replace(/^\.\/+/, '');
      const fallback = findByBasename(trimmed, moduleMap);
      if (fallback) {
        resolved = fallback;
      }
    }
    const isBare =
      !normalizedRequest.startsWith('.') && !normalizedRequest.startsWith('/');
    const isScoped = normalizedRequest.startsWith('@');
    const looksLikeFile =
      normalizedRequest.endsWith('.js') || normalizedRequest.includes('/');
    if (isBare && !moduleMap.has(resolved)) {
      if (isScoped || (!looksLikeFile && !normalizedRequest.includes('.'))) {
        return rootRequire(normalizedRequest);
      }
      throw new Error(`Cannot find module ${normalizedRequest}`);
    }
    if (!moduleMap.has(resolved)) {
      const available = Array.from(moduleMap.keys()).slice(0, 5).join(', ');
      throw new Error(
        `Cannot find module ${normalizedRequest}. Known models: ${available || 'none'}`
      );
    }
    if (cache.has(resolved)) return cache.get(resolved);
    const code = moduleMap.get(resolved) || '';
    const module = { exports: {} as any };
    const dirname = path.posix.dirname(resolved);
    const wrapper = `(function (module, exports, require, __filename, __dirname) { "use strict";\n${code}\n})`;
    const script = new vm.Script(wrapper, { filename: resolved });
    const fn = script.runInThisContext();
    fn(module, module.exports, (id: string) => localRequire(id, resolved), resolved, dirname);
    cache.set(resolved, module.exports);
    return module.exports;
  };

  const exportsList: any[] = [];
  models.forEach((model) => {
    const normalized = ensureJsExtension(normalizePath(model.path));
    if (!normalized) return;
    try {
      exportsList.push(localRequire(`./${normalized}`, ''));
    } catch {
      exportsList.push(localRequire(normalized, ''));
    }
  });

  return collectOrmExports(exportsList);
};
