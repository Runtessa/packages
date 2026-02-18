import type { SharedFileDto, SharedProjectDto } from '@/components/editor/types';
import { normalizeSharedPath, resolveSharedExtension } from './paths';

export const parseDependencies = (value: string) =>
  value
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

const UI_DEPENDENCY_EXCLUDES = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
]);

const isBareImport = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 && !trimmed.startsWith('.') && !trimmed.startsWith('/');
};

export const extractUiDependencies = (source: string) => {
  if (!source) return [] as string[];
  const results: string[] = [];
  const seen = new Set<string>();
  const addDep = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !isBareImport(trimmed)) return;
    if (UI_DEPENDENCY_EXCLUDES.has(trimmed)) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    results.push(trimmed);
  };

  const importFromRegex = /^\s*import(?:\s+type)?[\s\S]*?\s+from\s*['"]([^'"]+)['"]\s*;?/gm;
  const importSideEffectRegex = /^\s*import\s*['"]([^'"]+)['"]\s*;?/gm;
  const exportFromRegex = /^\s*export(?:\s+type)?[\s\S]*?\s+from\s*['"]([^'"]+)['"]\s*;?/gm;
  const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/gm;
  const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/gm;

  let match: RegExpExecArray | null;
  while ((match = importFromRegex.exec(source))) addDep(match[1]);
  while ((match = importSideEffectRegex.exec(source))) addDep(match[1]);
  while ((match = exportFromRegex.exec(source))) addDep(match[1]);
  while ((match = requireRegex.exec(source))) addDep(match[1]);
  while ((match = dynamicImportRegex.exec(source))) addDep(match[1]);

  return results;
};

export const compileWithBabel = (code: string): string => {
  const babel = typeof window !== 'undefined' ? (window as any).Babel : undefined;
  if (!babel || !babel.transform) return code;
  try {
    const result = babel.transform(code, {
      presets: [
        'es2015',
        'react',
        [
          'env',
          {
            useBuiltIns: 'entry',
            corejs: 3,
          },
        ],
      ],
    });
    return result?.code ?? code;
  } catch (er) {
    console.log(er);
    return code;
  }
};

export const buildCssModuleSource = (path: string, cssText: string) => {
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

export const buildSharedBundle = (project: SharedProjectDto, files: SharedFileDto[]) => {
  const moduleEntries: string[] = [];
  files.forEach((file) => {
    const normalizedPath = normalizeSharedPath(file.path);
    const source = file.content ?? '';
    const ext = resolveSharedExtension(normalizedPath, file.fileExtension);
    let compiled = '';
    if (ext === 'css') {
      compiled = buildCssModuleSource(normalizedPath, source);
    } else if (ext === 'json') {
      const jsonValue = source.trim() ? source : 'null';
      compiled = `module.exports = ${jsonValue};`;
    } else {
      if (typeof window !== 'undefined' && !(window as any).Babel) {
        throw new Error('Babel runtime not loaded in browser; cannot build bundle.');
      }
      compiled = compileWithBabel(source);
    }
    moduleEntries.push(
      `${JSON.stringify(normalizedPath)}: function(module, exports, require, __filename, __dirname) {\n${compiled}\n}`,
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
