import type { ExplorerNode } from '@/components/FileExplorer';
import type {
  EditorLanguage,
  ExplorerScope,
  FolderOverride,
  HistoryItem,
  ModuleDto,
  OrmModelDto,
  NodeMeta,
  SearchPattern,
  SearchResult,
  SearchMatchRange,
  SharedFileDto,
  SharedProjectDto,
  UIPackageDto,
  AclConfigDto,
} from '@/components/editor/types';
import {
  ACL_FILE_NAMES,
  ACL_FOLDER_NAME,
  DEFAULT_ACL_ENDPOINTS,
  DEFAULT_ACL_PERMISSIONS,
  DEFAULT_ACL_ROLES,
  DEFAULT_UI_EXTENSION,
  MODULE_EXTENSION,
  UI_EXTENSION_OPTIONS,
} from '@/components/editor/constants';

export const detectLanguage = (fileName: string): EditorLanguage => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) return 'jsx';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.ts')) return 'javascript';
  if (lower.endsWith('.js')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return 'plaintext';
};

export const sanitizeForFilename = (value: string) =>
  value
    .trim()
    .replace(/^\/+/, '')
    .replace(/[\/\\]+/g, '-')
    .replace(/[:*?<>|"]+/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

export const splitRoutePath = (routePath: string) => {
  const trimmed = routePath.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return [] as string[];
  return trimmed.split('/').filter(Boolean);
};

export const buildRoutePath = (segments: string[]) =>
  segments.length ? `/${segments.join('/')}` : '/';

export const splitUiName = (name: string) =>
  name
    .split(/[\\/]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);

export const buildUiName = (segments: string[]) => segments.join('/');

export const coerceModuleExtension = (value?: string) =>
  value && value.replace(/^\./, '').toLowerCase() === MODULE_EXTENSION
    ? MODULE_EXTENSION
    : MODULE_EXTENSION;

export const coerceUiExtension = (value?: string) => {
  const normalized = value?.replace(/^\./, '').toLowerCase();
  return normalized && UI_EXTENSION_OPTIONS.includes(normalized)
    ? normalized
    : DEFAULT_UI_EXTENSION;
};

export const formatModuleFileName = (mod: ModuleDto) => {
  return `${mod.method.toLowerCase()}.module.${coerceModuleExtension(mod.fileExtension)}`;
};

export const formatUiFileName = (pkg: UIPackageDto) => {
  const nameSegments = splitUiName(pkg.name || 'ui');
  const baseName = nameSegments[nameSegments.length - 1] || 'ui';
  return `${sanitizeForFilename(baseName)}.ui.${coerceUiExtension(pkg.fileExtension)}`;
};

export const getScopeInfo = (pathNodes: ExplorerNode[]) => {
  const moduleIndex = pathNodes.findIndex((node) => node.id === 'modules-root');
  if (moduleIndex >= 0) {
    return {
      scope: 'modules' as ExplorerScope,
      path: pathNodes.slice(moduleIndex + 1).map((node) => node.name),
    };
  }
  const modelIndex = pathNodes.findIndex((node) => node.id === 'models-root');
  if (modelIndex >= 0) {
    return {
      scope: 'models' as ExplorerScope,
      path: pathNodes.slice(modelIndex + 1).map((node) => node.name),
    };
  }
  const uiIndex = pathNodes.findIndex((node) => node.id === 'ui-root');
  if (uiIndex >= 0) {
    return {
      scope: 'ui' as ExplorerScope,
      path: pathNodes.slice(uiIndex + 1).map((node) => node.name),
    };
  }
  return { scope: null as ExplorerScope | null, path: [] as string[] };
};

export const getSharedPathFromNodes = (pathNodes: ExplorerNode[]) =>
  pathNodes.filter((_, index) => index > 0).map((node) => node.name);

export const findPathById = (root: ExplorerNode, nodeId: string): ExplorerNode[] => {
  const stack: { node: ExplorerNode; path: ExplorerNode[] }[] = [
    { node: root, path: [] },
  ];
  while (stack.length) {
    const { node, path } = stack.pop()!;
    const nextPath = [...path, node];
    if (node.id === nodeId) return nextPath;
    if (node.type === 'folder' && node.children) {
      node.children.forEach((child) => {
        stack.push({ node: child, path: nextPath });
      });
    }
  }
  return [];
};

export const getSharedNodeId = (fileId: string) => `shared-${fileId}`;

export const normalizeSharedPath = (value: string) =>
  value.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');

export const splitSharedPath = (value: string) => {
  const normalized = normalizeSharedPath(value);
  return normalized ? normalized.split('/').filter(Boolean) : [];
};

export const normalizeModelPath = (value: string) => {
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed) return '';
  const extMatch = trimmed.match(/\.([^.\/]+)$/);
  if (!extMatch) return `${trimmed}.js`;
  const ext = extMatch[1]?.toLowerCase();
  if (ext !== 'js') {
    return trimmed.replace(/\.[^.\/]+$/, '.js');
  }
  return trimmed;
};

export const splitModelPath = (value: string) => {
  const normalized = normalizeModelPath(value);
  return normalized ? normalized.split('/').filter(Boolean) : [];
};

export const makeSharedFolderId = (segments: string[]) => `shared-folder-${segments.join('/')}`;

export const ensureSharedFolderPath = (root: ExplorerNode, segments: string[]) => {
  let current = root;
  segments.forEach((segment, idx) => {
    const path = segments.slice(0, idx + 1);
    const id = makeSharedFolderId(path);
    const existing = current.children?.find(
      (child) => child.type === 'folder' && child.id === id
    );
    if (existing) {
      current = existing;
      return;
    }
    const next: ExplorerNode = {
      id,
      name: segment,
      type: 'folder',
      children: [],
    };
    current.children = [...(current.children ?? []), next];
    current = next;
  });
  return current;
};

export const buildSharedTree = (
  project: SharedProjectDto | null,
  files: SharedFileDto[],
  overrides: string[][],
  options?: { rootLabel?: string; sharedKind?: 'ui' | 'module' }
): ExplorerNode => {
  const root: ExplorerNode = {
    id: 'root',
    name: project?.name || options?.rootLabel || 'Shared Project',
    type: 'folder',
    children: [],
  };

  files.forEach((file) => {
    const segments = splitSharedPath(file.path);
    const fileName = segments.pop() || file.path || 'untitled';
    const parent = ensureSharedFolderPath(root, segments);
    parent.children = [
      ...(parent.children ?? []),
      {
        id: getSharedNodeId(file.id),
        name: fileName,
        type: 'file',
        meta: {
          kind: 'shared',
          projectId: project?.id ?? '',
          fileId: file.id,
          path: file.path,
          fileExtension: file.fileExtension,
          sharedKind: options?.sharedKind,
        } as NodeMeta,
        content: file.content,
      },
    ];
  });

  overrides.forEach((path) => {
    ensureSharedFolderPath(root, path);
  });

  return root;
};

export const buildSharedContentMap = (files: SharedFileDto[]) => {
  const next: Record<string, string> = {};
  files.forEach((file) => {
    next[getSharedNodeId(file.id)] = file.content ?? '';
  });
  return next;
};

export const buildExplorerTree = (
  modules: ModuleDto[],
  uiPackages: UIPackageDto[],
  models: OrmModelDto[],
  overrides: FolderOverride[],
  aclConfig?: AclConfigDto | null
): ExplorerNode => {
  const modulesRoot: ExplorerNode = {
    id: 'modules-root',
    name: 'Modules',
    type: 'folder',
    children: [],
  };
  const modelsRoot: ExplorerNode = {
    id: 'models-root',
    name: 'Models',
    type: 'folder',
    children: [],
  };
  const uiRoot: ExplorerNode = {
    id: 'ui-root',
    name: 'UI Entities',
    type: 'folder',
    children: [],
  };

  const ensureFolderPath = (
    root: ExplorerNode,
    scope: ExplorerScope,
    segments: string[]
  ) => {
    let current = root;
    segments.forEach((segment, idx) => {
      const path = segments.slice(0, idx + 1);
      const id = `${scope}-folder-${path.join('/')}`;
      const existing = current.children?.find(
        (child) => child.type === 'folder' && child.id === id
      );
      if (existing) {
        current = existing;
        return;
      }
      const next: ExplorerNode = {
        id,
        name: segment,
        type: 'folder',
        children: [],
      };
      current.children = [...(current.children ?? []), next];
      current = next;
    });
    return current;
  };

  const addAclFiles = () => {
    const aclFolder = ensureFolderPath(modulesRoot, 'modules', [ACL_FOLDER_NAME]);
    const permissionsContent =
      JSON.stringify(aclConfig?.permissions ?? JSON.parse(DEFAULT_ACL_PERMISSIONS), null, 2) + '\n';
    const rolesContent =
      JSON.stringify(aclConfig?.roles ?? JSON.parse(DEFAULT_ACL_ROLES), null, 2) + '\n';
    const endpointsContent =
      JSON.stringify(aclConfig?.endpoints ?? JSON.parse(DEFAULT_ACL_ENDPOINTS), null, 2) + '\n';

    aclFolder.children = [
      ...(aclFolder.children ?? []),
      {
        id: 'acl-permissions',
        name: ACL_FILE_NAMES.permissions,
        type: 'file',
        meta: { kind: 'acl', file: 'permissions' } as NodeMeta,
        content: permissionsContent,
      },
      {
        id: 'acl-roles',
        name: ACL_FILE_NAMES.roles,
        type: 'file',
        meta: { kind: 'acl', file: 'roles' } as NodeMeta,
        content: rolesContent,
      },
      {
        id: 'acl-endpoints',
        name: ACL_FILE_NAMES.endpoints,
        type: 'file',
        meta: { kind: 'acl', file: 'endpoints' } as NodeMeta,
        content: endpointsContent,
      },
    ];
  };

  modules.forEach((mod) => {
    const segments = splitRoutePath(mod.routePath || '/');
    const parent = ensureFolderPath(modulesRoot, 'modules', segments);
    parent.children = [
      ...(parent.children ?? []),
      {
        id: `module-${mod.id}`,
        name: formatModuleFileName(mod),
        type: 'file',
        meta: {
          kind: 'module',
          backendId: mod.id,
          method: mod.method,
          routePath: mod.routePath,
          fileExtension: coerceModuleExtension(mod.fileExtension),
        } as NodeMeta,
        content: mod.code,
      },
    ];
  });

  models.forEach((model) => {
    const segments = splitModelPath(model.path || '');
    const fileName = segments.pop() || model.path || 'model.js';
    const parent = ensureFolderPath(modelsRoot, 'models', segments);
    parent.children = [
      ...(parent.children ?? []),
      {
        id: `model-${model.id}`,
        name: fileName,
        type: 'file',
        meta: {
          kind: 'model',
          backendId: model.id,
          path: model.path,
          fileExtension: model.fileExtension,
        } as NodeMeta,
        content: model.code,
      },
    ];
  });

  uiPackages.forEach((pkg) => {
    const nameSegments = splitUiName(pkg.name || 'ui');
    const folderSegments = nameSegments.slice(0, -1);
    const parent = ensureFolderPath(uiRoot, 'ui', folderSegments);
    parent.children = [
      ...(parent.children ?? []),
      {
        id: `ui-${pkg.id}`,
        name: formatUiFileName(pkg),
        type: 'file',
        meta: {
          kind: 'ui',
          backendId: pkg.id,
          name: pkg.name,
          version: pkg.version,
          dependencies: pkg.dependencies ?? [],
          fileExtension: coerceUiExtension(pkg.fileExtension),
        } as NodeMeta,
        content: pkg.code ?? pkg.codeBlob,
      },
    ];
  });

  overrides.forEach((override) => {
    const root =
      override.scope === 'modules'
        ? modulesRoot
        : override.scope === 'models'
          ? modelsRoot
          : uiRoot;
    ensureFolderPath(root, override.scope, override.path);
  });

  addAclFiles();

  return {
    id: 'root',
    name: 'PROJECT',
    type: 'folder',
    children: [modulesRoot, modelsRoot, uiRoot],
  };
};

export const buildPersistedContentMap = (
  modules: ModuleDto[],
  uiPackages: UIPackageDto[],
  models: OrmModelDto[],
  aclConfig?: AclConfigDto | null
): Record<string, string> => {
  const next: Record<string, string> = {};
  modules.forEach((mod) => {
    next[`module-${mod.id}`] = mod.code ?? '';
  });
  models.forEach((model) => {
    next[`model-${model.id}`] = model.code ?? '';
  });
  uiPackages.forEach((pkg) => {
    next[`ui-${pkg.id}`] = pkg.code ?? pkg.codeBlob ?? '';
  });
  if (aclConfig) {
    next['acl-permissions'] = JSON.stringify(aclConfig.permissions ?? {}, null, 2) + '\n';
    next['acl-roles'] = JSON.stringify(aclConfig.roles ?? {}, null, 2) + '\n';
    next['acl-endpoints'] = JSON.stringify(aclConfig.endpoints ?? {}, null, 2) + '\n';
  }
  return next;
};

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

  const importFromRegex =
    /^\s*import(?:\s+type)?[\s\S]*?\s+from\s*['"]([^'"]+)['"]\s*;?/gm;
  const importSideEffectRegex = /^\s*import\s*['"]([^'"]+)['"]\s*;?/gm;
  const exportFromRegex =
    /^\s*export(?:\s+type)?[\s\S]*?\s+from\s*['"]([^'"]+)['"]\s*;?/gm;
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

export const extractFileExtension = (fileName: string) => {
  const idx = fileName.lastIndexOf('.');
  if (idx === -1 || idx === fileName.length - 1) return '';
  return fileName.slice(idx + 1);
};

export const formatHistoryTimestamp = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const getRevisionContent = (item: HistoryItem) => {
  if (item.kind === 'ui') {
    return item.code || item.codeBlob || '';
  }
  return item.code || '';
};

export const pathStartsWith = (path: string[], prefix: string[]) => {
  if (prefix.length > path.length) return false;
  return prefix.every((segment, idx) => path[idx] === segment);
};

export const compileWithBabel = (code: string): string => {
  const babel = typeof window !== 'undefined' ? window.Babel : undefined;
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

export const resolveSharedExtension = (path: string, explicit?: string) => {
  const normalized = explicit?.replace(/^\./, '').toLowerCase();
  if (normalized) return normalized;
  const idx = path.lastIndexOf('.');
  if (idx !== -1 && idx < path.length - 1) {
    return path.slice(idx + 1).toLowerCase();
  }
  return 'jsx';
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
      if (typeof window !== 'undefined' && !window.Babel) {
        throw new Error('Babel runtime not loaded in browser; cannot build bundle.');
      }
      compiled = compileWithBabel(source);
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

export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getFileIdFromUriPath = (path: string): string | null => {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  if (last === 'side') {
    return parts.length >= 2 ? parts[parts.length - 2] : null;
  }
  return last;
};

export const buildSearchPattern = (
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  useRegex: boolean
): SearchPattern => {
  const trimmed = query.trim();
  if (!trimmed) {
    return { source: '', isRegex: false, regex: null, error: null };
  }
  let source = useRegex ? trimmed : escapeRegExp(trimmed);
  let isRegex = useRegex;
  if (wholeWord) {
    source = `\\b${source}\\b`;
    isRegex = true;
  }
  if (!isRegex) {
    return { source: trimmed, isRegex: false, regex: null, error: null };
  }
  const flags = matchCase ? 'g' : 'gi';
  try {
    const regex = new RegExp(source, flags);
    return { source, isRegex: true, regex, error: null };
  } catch {
    return { source, isRegex: true, regex: null, error: 'Invalid regular expression' };
  }
};

export const buildSearchResults = (
  query: string,
  files: Array<{ id: string; name: string; content: string }>,
  pattern: SearchPattern,
  matchCase: boolean
): SearchResult[] => {
  const trimmed = query.trim();
  if (!trimmed || pattern.error) return [];
  const needle = trimmed.toLowerCase();
  const results: SearchResult[] = [];
  files.forEach((file) => {
    if (!file.content) return;
    const lines = file.content.split('\n');
    lines.forEach((line, lineIndex) => {
      if (pattern.regex) {
        const lineRegex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match: RegExpExecArray | null;
        while ((match = lineRegex.exec(line)) !== null) {
          const matchIndex = match.index;
          const matchText = match[0] ?? '';
          const startColumn = matchIndex + 1;
          const endColumn = matchIndex + matchText.length + 1;
          const preview = line.trim();
          results.push({
            id: `${file.id}:${lineIndex}:${matchIndex}`,
            fileId: file.id,
            fileName: file.name,
            line: lineIndex + 1,
            column: startColumn,
            preview: preview || line,
            range: {
              startLineNumber: lineIndex + 1,
              startColumn,
              endLineNumber: lineIndex + 1,
              endColumn,
            },
          });
          if (matchText.length === 0) {
            lineRegex.lastIndex += 1;
          }
        }
        return;
      }
      const source = matchCase ? line : line.toLowerCase();
      const lookup = matchCase ? trimmed : needle;
      let fromIndex = 0;
      while (true) {
        const matchIndex = source.indexOf(lookup, fromIndex);
        if (matchIndex === -1) break;
        const startColumn = matchIndex + 1;
        const endColumn = matchIndex + trimmed.length + 1;
        const preview = line.trim();
        results.push({
          id: `${file.id}:${lineIndex}:${matchIndex}`,
          fileId: file.id,
          fileName: file.name,
          line: lineIndex + 1,
          column: startColumn,
          preview: preview || line,
          range: {
            startLineNumber: lineIndex + 1,
            startColumn,
            endLineNumber: lineIndex + 1,
            endColumn,
          },
        });
        fromIndex = matchIndex + Math.max(1, lookup.length);
      }
    });
  });
  return results;
};

export const parseFilterRegex = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return { regex: null as RegExp | null, error: null as string | null };
  }
  try {
    return { regex: new RegExp(trimmed, 'i'), error: null };
  } catch {
    return { regex: null, error: 'Invalid regex' };
  }
};

export const replaceAtRange = (
  content: string,
  range: SearchMatchRange,
  replacement: string
) => {
  const lines = content.split('\n');
  const startLineIndex = range.startLineNumber - 1;
  const endLineIndex = range.endLineNumber - 1;
  if (startLineIndex < 0 || endLineIndex >= lines.length) return content;
  let startOffset = 0;
  for (let i = 0; i < startLineIndex; i += 1) {
    startOffset += lines[i].length + 1;
  }
  let endOffset = startOffset;
  if (startLineIndex === endLineIndex) {
    endOffset += range.endColumn - 1;
  } else {
    endOffset += lines[startLineIndex].length + 1;
    for (let i = startLineIndex + 1; i < endLineIndex; i += 1) {
      endOffset += lines[i].length + 1;
    }
    endOffset += range.endColumn - 1;
  }
  startOffset += range.startColumn - 1;
  return content.slice(0, startOffset) + replacement + content.slice(endOffset);
};
