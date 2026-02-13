import { transformSync } from '@babel/core';
import presetEnv from '@babel/preset-env';
import presetReact from '@babel/preset-react';
import presetTypescript from '@babel/preset-typescript';

const normalizeExtension = (value?: string | null) => {
  if (!value) return '';
  return value.replace(/^\./, '').toLowerCase();
};

export const compileUiSource = (code: string, extension?: string | null) => {
  const ext = normalizeExtension(extension);
  if (ext === 'css' || ext === 'json') return code;
  try {
    const result = transformSync(code, {
      filename: `file.${ext || 'js'}`,
      presets: [
        [presetEnv, { targets: { esmodules: true } }],
        [presetReact, { runtime: 'classic' }],
        ext === 'ts' || ext === 'tsx'
          ? [presetTypescript, { isTSX: ext === 'tsx', allExtensions: true }]
          : null,
      ].filter(Boolean) as any[],
    });
    return result?.code ?? code;
  } catch (err) {
    console.error('Assistant Babel compile failed:', err);
    return code;
  }
};

const normalizeSharedPath = (path: string) => path.replace(/\\/g, '/').replace(/^\/+/, '');

const resolveSharedExtension = (path: string, explicit?: string | null) => {
  const normalized = normalizeExtension(explicit);
  if (normalized) {
    if (normalized === 'ts') return 'js';
    if (normalized === 'tsx') return 'jsx';
    return normalized;
  }
  const idx = path.lastIndexOf('.');
  if (idx !== -1 && idx < path.length - 1) {
    const ext = path.slice(idx + 1).toLowerCase();
    if (ext === 'ts') return 'js';
    if (ext === 'tsx') return 'jsx';
    return ext;
  }
  return 'jsx';
};

const buildCssModuleSource = (path: string, cssText: string) => {
  const safeText = JSON.stringify(cssText ?? '');
  const id = JSON.stringify(`shared-style:${path}`);
  return `
const cssText = ${safeText};
if (typeof document !== 'undefined') {
  const attr = 'data-shared-style';
  let style = document.querySelector('style[' + attr + '=' + ${id} + ']');
  if (!style) {
    style = document.createElement('style');
    style.setAttribute(attr, ${id});
    document.head.appendChild(style);
  }
  if (style.textContent !== cssText) {
    style.textContent = cssText;
  }
}
module.exports = cssText;
`;
};

export const buildSharedBundle = (
  project: { entryPath: string },
  files: Array<{ path: string; content: string; fileExtension?: string | null }>
) => {
  const moduleEntries: string[] = [];
  files.forEach((file) => {
    const normalizedPath = normalizeSharedPath(file.path || '');
    const source = file.content ?? '';
    const ext = resolveSharedExtension(normalizedPath, file.fileExtension);
    let compiled = '';
    if (ext === 'css') {
      compiled = buildCssModuleSource(normalizedPath, source);
    } else if (ext === 'json') {
      const jsonValue = source.trim() ? source : 'null';
      compiled = `module.exports = ${jsonValue};`;
    } else {
      compiled = compileUiSource(source, ext);
    }
    moduleEntries.push(
      `${JSON.stringify(normalizedPath)}: function(module, exports, require, __filename, __dirname) {\n${compiled}\n}`
    );
  });

  const entryPath = normalizeSharedPath(project.entryPath || 'src/index.jsx');
  const bundleLines = [
    'const __modules = {',
    moduleEntries.join(',\n'),
    '};',
    'const __cache = {};',
    "const __extensions = ['.jsx', '.js', '.json', '.css'];",
    'const __externalRequire = require;',
    'const __normalize = (value) => {',
    "  const parts = String(value || '').split('/').filter(Boolean);",
    '  const stack = [];',
    '  for (const part of parts) {',
    "    if (part === '.' || part === '') continue;",
    "    if (part === '..') { stack.pop(); continue; }",
    '    stack.push(part);',
    '  }',
    "  return stack.join('/');",
    '};',
    'const __resolve = (request, from) => {',
    "  const raw = String(request || '');",
    '  const normalizedBare = __normalize(raw);',
    '  if (__modules[normalizedBare]) return normalizedBare;',
    '  for (const ext of __extensions) {',
    '    if (__modules[normalizedBare + ext]) return normalizedBare + ext;',
    '  }',
    "  if (!raw.startsWith('.') && !raw.startsWith('/')) return raw;",
    '  const baseParts = from ? String(from).split(`/`).slice(0, -1) : [];',
    "  const targetParts = raw.startsWith('/') ? raw.split('/') : baseParts.concat(raw.split('/'));",
    '  const normalized = __normalize(targetParts.join(`/`));',
    '  if (__modules[normalized]) return normalized;',
    '  for (const ext of __extensions) {',
    '    if (__modules[normalized + ext]) return normalized + ext;',
    '  }',
    '  return normalized;',
    '};',
    'const __require = (request, from) => {',
    "  const raw = String(request || '');",
    '  const resolved = __resolve(raw, from || "");',
    '  const factory = __modules[resolved];',
    '  if (!factory) {',
    "    if (!raw.startsWith('.') && !raw.startsWith('/')) {",
    '      return __externalRequire(raw);',
    '    }',
    "    throw new Error('Cannot find module ' + raw);",
    '  }',
    '  if (__cache[resolved]) return __cache[resolved].exports;',
    '  const module = { exports: {} };',
    '  __cache[resolved] = module;',
    "  const dirname = resolved.split('/').slice(0, -1).join('/');",
    '  factory(module, module.exports, (id) => __require(id, resolved), resolved, dirname);',
    '  return module.exports;',
    '};',
    `module.exports = __require(${JSON.stringify(entryPath)});`,
  ];
  return bundleLines.join('\n');
};
