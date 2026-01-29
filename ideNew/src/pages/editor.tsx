import '@/lib/monaco';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import Script from 'next/script';
import { useRouter } from 'next/router';
import type * as monaco from 'monaco-editor';
import {
  FiChevronLeft,
  FiChevronRight,
  FiClock,
  FiEye,
  FiEyeOff,
  FiFolder,
  FiFlag,
  FiCornerDownLeft,
  FiChevronsRight,
  FiRefreshCw,
  FiRotateCcw,
  FiSearch,
} from 'react-icons/fi';
import FileExplorer, { ExplorerNode } from '@/components/FileExplorer';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import { FormLayout } from '@/components/ui/FormLayout';
import { useToast } from '@/components/ui/Toast';
import { useSessionToken } from '@/lib/client/session';
import { getSelectedTenantHost } from '@/lib/client/tenant';
import branding from '@/branding.json';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });
const MonacoDiffEditor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.DiffEditor),
  { ssr: false }
);

const CORE_API_BASE = process.env.NEXT_PUBLIC_CORE_API_URL?.trim() || '';

type EditorLanguage =
  | 'javascript'
  | 'jsx'
  | 'css'
  | 'html'
  | 'json'
  | 'markdown'
  | 'plaintext';

type ActiveFile = {
  id: string;
  name: string;
  language: EditorLanguage;
  meta: NodeMeta | null;
};

type TabContextMenuState = {
  x: number;
  y: number;
  fileId: string;
};

type SearchMatchRange = monaco.IRange;

type SearchResult = {
  id: string;
  fileId: string;
  fileName: string;
  line: number;
  column: number;
  preview: string;
  range: SearchMatchRange;
};

type SearchPattern = {
  source: string;
  isRegex: boolean;
  regex: RegExp | null;
  error: string | null;
};

declare global {
  interface Window {
    Babel?: {
      transform: (code: string, opts: Record<string, unknown>) => { code: string };
    };
  }
}

type NodeMeta =
  | {
      kind: 'module';
      backendId: string;
      method: string;
      routePath: string;
      fileExtension?: string;
    }
  | {
      kind: 'ui';
      backendId: string;
      name: string;
      version: string;
      dependencies: string[];
      fileExtension?: string;
    }
  | {
      kind: 'shared';
      projectId: string;
      fileId: string;
      path: string;
      fileExtension?: string;
    };

type PreviewTarget = {
  kind: 'ui' | 'shared';
  name: string;
  version: string;
};

type ModuleDto = {
  id: string;
  routePath: string;
  method: string;
  code: string;
  fileExtension?: string;
  draftVersion?: string;
  publishedVersion?: string;
  publishedAt?: string;
};

type UIPackageDto = {
  id: string;
  name: string;
  version: string;
  code?: string;
  codeBlob: string;
  dependencies: string[];
  fileExtension?: string;
  draftVersion?: string;
  publishedVersion?: string;
  publishedAt?: string;
};

type SharedProjectDto = {
  id: string;
  name: string;
  version: string;
  entryPath: string;
  dependencies: string[];
  fileExtension?: string;
  draftVersion?: string;
  publishedVersion?: string;
  publishedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type SharedFileDto = {
  id: string;
  path: string;
  fileExtension?: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
};

type ModuleRevisionDto = {
  id: string;
  revision: number;
  routePath: string;
  method: string;
  code: string;
  fileExtension?: string;
  action?: string;
  createdAt: string;
  createdBy?: string;
};

type UiRevisionDto = {
  id: string;
  revision: number;
  name: string;
  version: string;
  code: string;
  codeBlob: string;
  dependencies: string[];
  fileExtension?: string;
  action?: string;
  createdAt: string;
  createdBy?: string;
};

type HistoryItem =
  | (ModuleRevisionDto & { kind: 'module' })
  | (UiRevisionDto & { kind: 'ui' });

type HistoryResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

type StagingItem = {
  id: string;
  kind: 'module' | 'ui' | 'shared';
  title: string;
  draftVersion?: string;
  publishedVersion?: string;
  publishedAt?: string;
  backendId?: string;
  projectId?: string;
  fileId?: string;
  dirty?: boolean;
};

type ExplorerScope = 'modules' | 'ui';
type PanelScope = 'modules' | 'ui' | 'shared';

type FolderOverride = {
  scope: ExplorerScope;
  path: string[];
};

type ModuleFormState = {
  routePath: string;
  method: string;
  fileExtension: string;
  code: string;
};

type UiFormState = {
  name: string;
  version: string;
  fileExtension: string;
  dependencies: string;
  code: string;
};

type FolderFormState = {
  name: string;
};

type SharedFileFormState = {
  path: string;
  content: string;
};

const LANGUAGE_OPTIONS: { value: EditorLanguage; label: string }[] = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'jsx', label: 'JSX' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'plaintext', label: 'Plain Text' },
];

const EDITOR_NAV_ITEMS = [
  { label: 'Editor', href: '/editor', match: '/editor' },
  { label: 'Dashboard', href: '/dashboard', match: '/dashboard' },
  { label: 'Docs', href: '/docs', match: '/docs' },
  { label: 'Shared Projects', href: '/admin/shared-packages', match: '/admin/shared-packages' },
  { label: 'Tenants', href: '/admin/tenants', match: '/admin/tenants' },
];


const detectLanguage = (fileName: string): EditorLanguage => {
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

const sanitizeForFilename = (value: string) =>
  value
    .trim()
    .replace(/^\/+/, '')
    .replace(/[\/\\]+/g, '-')
    .replace(/[:*?<>|"]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

const splitRoutePath = (routePath: string) => {
  const trimmed = routePath.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return [];
  return trimmed.split('/').filter(Boolean);
};

const buildRoutePath = (segments: string[]) =>
  segments.length ? `/${segments.join('/')}` : '/';

const splitUiName = (name: string) =>
  name
    .split(/[\\/]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);

const buildUiName = (segments: string[]) => segments.join('/');

const MODULE_EXTENSION = 'js';
const DEFAULT_UI_EXTENSION = 'jsx';
const UI_EXTENSION_OPTIONS = [DEFAULT_UI_EXTENSION, 'js', 'css'];

const coerceModuleExtension = (value?: string) =>
  value && value.replace(/^\./, '').toLowerCase() === MODULE_EXTENSION
    ? MODULE_EXTENSION
    : MODULE_EXTENSION;

const coerceUiExtension = (value?: string) => {
  const normalized = value?.replace(/^\./, '').toLowerCase();
  return normalized && UI_EXTENSION_OPTIONS.includes(normalized)
    ? normalized
    : DEFAULT_UI_EXTENSION;
};

const formatModuleFileName = (mod: ModuleDto) => {
  return `${mod.method.toLowerCase()}.module.${coerceModuleExtension(mod.fileExtension)}`;
};

const formatUiFileName = (pkg: UIPackageDto) => {
  const nameSegments = splitUiName(pkg.name || 'ui');
  const baseName = nameSegments[nameSegments.length - 1] || 'ui';
  return `${sanitizeForFilename(baseName)}.ui.${coerceUiExtension(pkg.fileExtension)}`;
};

const getScopeInfo = (pathNodes: ExplorerNode[]) => {
  const moduleIndex = pathNodes.findIndex((node) => node.id === 'modules-root');
  if (moduleIndex >= 0) {
    return {
      scope: 'modules' as ExplorerScope,
      path: pathNodes.slice(moduleIndex + 1).map((node) => node.name),
    };
  }
  const uiIndex = pathNodes.findIndex((node) => node.id === 'ui-root');
  if (uiIndex >= 0) {
    return {
      scope: 'ui' as ExplorerScope,
      path: pathNodes.slice(uiIndex + 1).map((node) => node.name),
    };
  }
  return { scope: null, path: [] as string[] };
};

const getSharedPathFromNodes = (pathNodes: ExplorerNode[]) =>
  pathNodes.filter((_, index) => index > 0).map((node) => node.name);

const findPathById = (root: ExplorerNode, nodeId: string): ExplorerNode[] => {
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

const MODULE_METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const FILE_EXTENSION_OPTIONS = [MODULE_EXTENSION];
const FOLDER_STORAGE_KEY = 'editor-folder-overrides';
const SHARED_FOLDER_STORAGE_KEY = 'editor-shared-folder-overrides';
const PREVIEW_PORT_STORAGE_KEY = 'editor-preview-port';
const DEFAULT_PREVIEW_PORT = process.env.NEXT_PUBLIC_KERNEL_PREVIEW_PORT?.trim() || '3000';

const DEFAULT_MODULE_CODE = `module.exports = async function handler(req, adapters) {
  return {
    statusCode: 200,
    body: { ok: true },
  };
};
`;

const DEFAULT_UI_CODE = `export default function NewComponent() {
  return <div>New component</div>;
}
`;
const DEFAULT_CSS_CODE = `/* Add styles for UI entities here */`;
const DEFAULT_SHARED_FILE: SharedFileFormState = {
  path: '',
  content: '',
};

const makeFolderId = (scope: ExplorerScope, segments: string[]) =>
  `${scope}-folder-${segments.join('/')}`;

const ensureFolderPath = (
  root: ExplorerNode,
  scope: ExplorerScope,
  segments: string[]
) => {
  let current = root;
  segments.forEach((segment, idx) => {
    const path = segments.slice(0, idx + 1);
    const id = makeFolderId(scope, path);
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

const buildExplorerTree = (
  modules: ModuleDto[],
  uiPackages: UIPackageDto[],
  overrides: FolderOverride[]
): ExplorerNode => {
  const modulesRoot: ExplorerNode = {
    id: 'modules-root',
    name: 'Modules',
    type: 'folder',
    children: [],
  };
  const uiRoot: ExplorerNode = {
    id: 'ui-root',
    name: 'UI Entities',
    type: 'folder',
    children: [],
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
        },
        content: mod.code,
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
        },
        content: pkg.code ?? pkg.codeBlob,
      },
    ];
  });

  overrides.forEach((override) => {
    const root = override.scope === 'modules' ? modulesRoot : uiRoot;
    ensureFolderPath(root, override.scope, override.path);
  });

  return {
    id: 'root',
    name: 'PROJECT',
    type: 'folder',
    children: [modulesRoot, uiRoot],
  };
};

const buildPersistedContentMap = (
  modules: ModuleDto[],
  uiPackages: UIPackageDto[]
): Record<string, string> => {
  const next: Record<string, string> = {};
  modules.forEach((mod) => {
    next[`module-${mod.id}`] = mod.code ?? '';
  });
  uiPackages.forEach((pkg) => {
    next[`ui-${pkg.id}`] = pkg.code ?? pkg.codeBlob ?? '';
  });
  return next;
};

const SHARED_NODE_PREFIX = 'shared-';

const getSharedNodeId = (fileId: string) => `${SHARED_NODE_PREFIX}${fileId}`;

const normalizeSharedPath = (value: string) =>
  value.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');

const splitSharedPath = (value: string) => {
  const normalized = normalizeSharedPath(value);
  return normalized ? normalized.split('/').filter(Boolean) : [];
};

const makeSharedFolderId = (segments: string[]) =>
  `shared-folder-${segments.join('/')}`;

const ensureSharedFolderPath = (root: ExplorerNode, segments: string[]) => {
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

const buildSharedTree = (
  project: SharedProjectDto | null,
  files: SharedFileDto[],
  overrides: string[][]
): ExplorerNode => {
  const root: ExplorerNode = {
    id: 'root',
    name: project?.name || 'Shared Project',
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
        },
        content: file.content,
      },
    ];
  });

  overrides.forEach((path) => {
    ensureSharedFolderPath(root, path);
  });

  return root;
};

const buildSharedContentMap = (files: SharedFileDto[]) => {
  const next: Record<string, string> = {};
  files.forEach((file) => {
    next[getSharedNodeId(file.id)] = file.content ?? '';
  });
  return next;
};

const parseDependencies = (value: string) =>
  value
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

const LEFT_PANEL_STORAGE_KEY = 'editor-left-panel-width';
const MIN_LEFT_PANEL_WIDTH = 150;
const MAX_LEFT_PANEL_WIDTH = 520;
const DEFAULT_LEFT_PANEL_WIDTH = 320;
const SPLIT_RATIO_STORAGE_KEY = 'editor-split-ratio';
const DEFAULT_SPLIT_RATIO = 0.5;
const MIN_SPLIT_PX = 240;
const HISTORY_PAGE_SIZE = 20;

const extractFileExtension = (fileName: string) => {
  const idx = fileName.lastIndexOf('.');
  if (idx === -1 || idx === fileName.length - 1) return '';
  return fileName.slice(idx + 1);
};

const formatHistoryTimestamp = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const getRevisionContent = (item: HistoryItem) => {
  if (item.kind === 'ui') {
    return item.code || item.codeBlob || '';
  }
  return item.code || '';
};

const pathStartsWith = (path: string[], prefix: string[]) => {
  if (prefix.length > path.length) return false;
  return prefix.every((segment, idx) => path[idx] === segment);
};

const compileWithBabel = (code: string): string => {
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

const resolveSharedExtension = (path: string, explicit?: string) => {
  const normalized = explicit?.replace(/^\./, '').toLowerCase();
  if (normalized) return normalized;
  const idx = path.lastIndexOf('.');
  if (idx !== -1 && idx < path.length - 1) {
    return path.slice(idx + 1).toLowerCase();
  }
  return 'tsx';
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

const buildSharedBundle = (project: SharedProjectDto, files: SharedFileDto[]) => {
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

  const entryPath = normalizeSharedPath(project.entryPath || 'src/index.tsx');
  const bundleLines = [
    'const __modules = {',
    moduleEntries.join(',\n'),
    '};',
    'const __cache = {};',
    "const __extensions = ['.tsx', '.ts', '.jsx', '.js', '.json', '.css'];",
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

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getFileIdFromUriPath = (path: string): string | null => {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  if (last === 'side') {
    return parts.length >= 2 ? parts[parts.length - 2] : null;
  }
  return last;
};

const buildSearchPattern = (
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

const buildSearchResults = (
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

const parseFilterRegex = (value: string) => {
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

const replaceAtRange = (
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

export default function EditorPage() {
  const router = useRouter();
  const { token, clear, ready } = useSessionToken();
  const { success, error: showError } = useToast();
  const sharedProjectId = useMemo(() => {
    if (!router.isReady) return null;
    const value = router.query.sharedProject;
    return typeof value === 'string' && value.trim() ? value : null;
  }, [router.isReady, router.query.sharedProject]);
  const isSharedMode = Boolean(sharedProjectId);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [savedContents, setSavedContents] = useState<Record<string, string>>({});
  const savedContentsRef = useRef<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);
  const [openFiles, setOpenFiles] = useState<ActiveFile[]>([]);
  const [treeData, setTreeData] = useState<ExplorerNode | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState<string>('');
  const [modulesData, setModulesData] = useState<ModuleDto[]>([]);
  const [uiData, setUiData] = useState<UIPackageDto[]>([]);
  const [sharedProject, setSharedProject] = useState<SharedProjectDto | null>(null);
  const [sharedFiles, setSharedFiles] = useState<SharedFileDto[]>([]);
  const sharedFilesRef = useRef<SharedFileDto[]>([]);
  const [sharedFolderOverrides, setSharedFolderOverrides] = useState<string[][]>(
    []
  );
  const [folderOverrides, setFolderOverrides] = useState<FolderOverride[]>([]);
  const [tenantHost, setTenantHost] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'folder' | null>(null);
  const [createScope, setCreateScope] = useState<PanelScope | null>(null);
  const [createParentPath, setCreateParentPath] = useState<string[]>([]);
  const [moduleForm, setModuleForm] = useState<ModuleFormState>({
    routePath: '/',
    method: 'GET',
    fileExtension: MODULE_EXTENSION,
    code: DEFAULT_MODULE_CODE,
  });
  const [uiForm, setUiForm] = useState<UiFormState>({
    name: 'NewComponent',
    version: '1.0.0',
    fileExtension: DEFAULT_UI_EXTENSION,
    dependencies: '',
    code: DEFAULT_UI_CODE,
  });
  const [sharedFileForm, setSharedFileForm] =
    useState<SharedFileFormState>(DEFAULT_SHARED_FILE);
  const [folderForm, setFolderForm] = useState<FolderFormState>({ name: '' });
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editMeta, setEditMeta] = useState<NodeMeta | null>(null);
  const [editModuleForm, setEditModuleForm] = useState<ModuleFormState>({
    routePath: '/',
    method: 'GET',
    fileExtension: MODULE_EXTENSION,
    code: '',
  });
  const [editUiForm, setEditUiForm] = useState<UiFormState>({
    name: '',
    version: '',
    fileExtension: DEFAULT_UI_EXTENSION,
    dependencies: '',
    code: '',
  });
  const [editSharedPath, setEditSharedPath] = useState('');
  const [renameFolderOpen, setRenameFolderOpen] = useState(false);
  const [renameFolderScope, setRenameFolderScope] = useState<PanelScope | null>(null);
  const [renameFolderPath, setRenameFolderPath] = useState<string[]>([]);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: 'file'; scope: PanelScope; meta: NodeMeta; label: string }
    | { type: 'folder'; scope: PanelScope; path: string[]; label: string }
    | null
  >(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_LEFT_PANEL_WIDTH;
    const stored = localStorage.getItem(LEFT_PANEL_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_LEFT_PANEL_WIDTH;
  });
  const [splitRatio, setSplitRatio] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_SPLIT_RATIO;
    const stored = localStorage.getItem(SPLIT_RATIO_STORAGE_KEY);
    const parsed = stored ? Number.parseFloat(stored) : NaN;
    if (!Number.isFinite(parsed)) return DEFAULT_SPLIT_RATIO;
    return Math.min(0.8, Math.max(0.2, parsed));
  });
  const leftPanelWidthRef = useRef(leftPanelWidth);
  const resizeRef = useRef<{ active: boolean; startX: number; startWidth: number }>({
    active: false,
    startX: 0,
    startWidth: DEFAULT_LEFT_PANEL_WIDTH,
  });
  const splitRatioRef = useRef(splitRatio);
  const splitResizeRef = useRef<{ active: boolean }>({ active: false });
  const dragTabIdRef = useRef<string | null>(null);
  const [leftPanel, setLeftPanel] = useState<
    'explorer' | 'history' | 'search' | 'staging'
  >('explorer');
  const [stagingBusy, setStagingBusy] = useState(false);
  const [stagingBusyId, setStagingBusyId] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historySelectedId, setHistorySelectedId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(HISTORY_PAGE_SIZE);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const historyRowRef = useRef<HTMLDivElement | null>(null);
  const [sideFileId, setSideFileId] = useState<string | null>(null);
  const [closePromptOpen, setClosePromptOpen] = useState(false);
  const [pendingCloseIds, setPendingCloseIds] = useState<string[]>([]);
  const [pendingCloseBusy, setPendingCloseBusy] = useState(false);
  const [pendingCloseAction, setPendingCloseAction] = useState<
    'close' | 'reload' | null
  >(null);
  const [rightPaneIds, setRightPaneIds] = useState<string[]>([]);
  const editorAreaRef = useRef<HTMLDivElement | null>(null);
  const mainEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const sideEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const searchDecorationsRef = useRef<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSelected, setSearchSelected] = useState<SearchResult | null>(null);
  const [pendingSearchSelection, setPendingSearchSelection] =
    useState<SearchResult | null>(null);
  const [searchMatchCase, setSearchMatchCase] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchUseRegex, setSearchUseRegex] = useState(false);
  const [searchReplace, setSearchReplace] = useState('');
  const [searchIncludePattern, setSearchIncludePattern] = useState('');
  const [searchExcludePattern, setSearchExcludePattern] = useState('');

  const [editorView, setEditorView] = useState<'code' | 'preview'>('code');
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [previewPort, setPreviewPort] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_PREVIEW_PORT;
    const stored = localStorage.getItem(PREVIEW_PORT_STORAGE_KEY);
    return stored !== null ? stored : DEFAULT_PREVIEW_PORT;
  });
  const previewBaseUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    if (!tenantHost) return '';
    const protocol = window.location.protocol || 'http:';
    const host = tenantHost
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0];
    const normalizedPort = previewPort.trim();
    const portSuffix = normalizedPort ? `:${normalizedPort}` : '';
    return `${protocol}//${host}${portSuffix}`;
  }, [previewPort, tenantHost]);
  const sidebarLabel = isSharedMode
    ? sharedProject?.name || 'Shared Project'
    : tenantHost || 'None';
  const sidebarLabelTone = isSharedMode
    ? 'text-gray-200'
    : tenantHost
      ? 'text-gray-200'
      : 'text-red-200';
  const rightPaneSet = useMemo(() => new Set(rightPaneIds), [rightPaneIds]);
  const leftTabs = useMemo(
    () => openFiles.filter((file) => !rightPaneSet.has(file.id)),
    [openFiles, rightPaneSet]
  );
  const rightTabs = useMemo(
    () => openFiles.filter((file) => rightPaneSet.has(file.id)),
    [openFiles, rightPaneSet]
  );
  useEffect(() => {
    savedContentsRef.current = savedContents;
  }, [savedContents]);
  useEffect(() => {
    sharedFilesRef.current = sharedFiles;
  }, [sharedFiles]);
  useEffect(() => {
    if (leftTabs.length > 0 || rightTabs.length === 0) return;
    setRightPaneIds([]);
    setSideFileId(null);
    if (!activeFile || rightTabs[0].id !== activeFile.id) {
      setActiveFile(rightTabs[0]);
    }
  }, [activeFile, leftTabs, rightTabs]);
  const sideFile = useMemo(
    () => rightTabs.find((file) => file.id === sideFileId) ?? rightTabs[0] ?? null,
    [rightTabs, sideFileId]
  );
  const [tabMenu, setTabMenu] = useState<TabContextMenuState | null>(null);

  const resolveApiUrl = useCallback((url: string) => {
    if (/^https?:\/\//i.test(url)) return url;
    if (!CORE_API_BASE) return url;
    const base = CORE_API_BASE.replace(/\/$/, '');
    return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
  }, []);

  const apiFetch = useCallback(
    async (url: string, options: { method?: string; body?: unknown } = {}) => {
      if (!token) {
        const err = new Error('Session token is missing');
        (err as any).statusCode = 401;
        throw err;
      }
      const tenantHost = getSelectedTenantHost();
      if (!tenantHost) {
        const err = new Error('Select a tenant in /admin/tenants to use the editor.');
        (err as any).statusCode = 400;
        throw err;
      }
      const res = await fetch(resolveApiUrl(url), {
        method: options.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantHost ? { 'X-Tenant-Host': tenantHost } : {}),
          ...(token ? { Authorization: `Session ${token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        if (res.status === 401) {
          clear();
        }
        throw new Error(data.error || 'Request failed');
      }
      return data;
    },
    [clear, resolveApiUrl, token]
  );

  const adminFetch = useCallback(
    async (url: string, options: { method?: string; body?: unknown } = {}) => {
      if (!token) {
        const err = new Error('Session token is missing');
        (err as any).statusCode = 401;
        throw err;
      }
      const res = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Session ${token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        if (res.status === 401) {
          clear();
        }
        throw new Error(data.error || 'Request failed');
      }
      return data;
    },
    [clear, token]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setTenantHost(getSelectedTenantHost());
  }, [ready]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(PREVIEW_PORT_STORAGE_KEY, previewPort);
  }, [previewPort]);

  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth;
  }, [leftPanelWidth]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!resizeRef.current.active) return;
      const delta = event.clientX - resizeRef.current.startX;
      const nextWidth = Math.min(
        MAX_LEFT_PANEL_WIDTH,
        Math.max(MIN_LEFT_PANEL_WIDTH, resizeRef.current.startWidth + delta)
      );
      setLeftPanelWidth(nextWidth);
    };

    const handleUp = () => {
      if (!resizeRef.current.active) return;
      resizeRef.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          LEFT_PANEL_STORAGE_KEY,
          String(leftPanelWidthRef.current)
        );
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!splitResizeRef.current.active) return;
      if (!editorAreaRef.current) return;
      const rect = editorAreaRef.current.getBoundingClientRect();
      if (!rect.width) return;
      const offset = event.clientX - rect.left;
      const minRatio = Math.min(0.45, MIN_SPLIT_PX / rect.width);
      const maxRatio = 1 - minRatio;
      const nextRatio = Math.max(minRatio, Math.min(maxRatio, offset / rect.width));
      setSplitRatio(nextRatio);
    };

    const handleUp = () => {
      if (!splitResizeRef.current.active) return;
      splitResizeRef.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isSharedMode) {
      setFolderOverrides([]);
      return;
    }
    if (!tenantHost) {
      setFolderOverrides([]);
      return;
    }
    const stored = localStorage.getItem(`${FOLDER_STORAGE_KEY}:${tenantHost}`);
    if (!stored) {
      setFolderOverrides([]);
      return;
    }
    try {
      const parsed = JSON.parse(stored) as FolderOverride[];
      setFolderOverrides(parsed);
    } catch {
      setFolderOverrides([]);
    }
  }, [isSharedMode, tenantHost]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isSharedMode) return;
    if (!tenantHost) return;
    localStorage.setItem(
      `${FOLDER_STORAGE_KEY}:${tenantHost}`,
      JSON.stringify(folderOverrides)
    );
  }, [folderOverrides, isSharedMode, tenantHost]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isSharedMode || !sharedProjectId) {
      setSharedFolderOverrides([]);
      return;
    }
    const stored = localStorage.getItem(
      `${SHARED_FOLDER_STORAGE_KEY}:${sharedProjectId}`
    );
    if (!stored) {
      setSharedFolderOverrides([]);
      return;
    }
    try {
      const parsed = JSON.parse(stored) as string[][];
      setSharedFolderOverrides(parsed);
    } catch {
      setSharedFolderOverrides([]);
    }
  }, [isSharedMode, sharedProjectId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isSharedMode || !sharedProjectId) return;
    localStorage.setItem(
      `${SHARED_FOLDER_STORAGE_KEY}:${sharedProjectId}`,
      JSON.stringify(sharedFolderOverrides)
    );
  }, [isSharedMode, sharedFolderOverrides, sharedProjectId]);

  useEffect(() => {
    if (isSharedMode) return;
    if (!treeData) return;
    setTreeData(buildExplorerTree(modulesData, uiData, folderOverrides));
  }, [folderOverrides, isSharedMode, modulesData, uiData]);


  const loadSharedProject = useCallback(async () => {
    if (!sharedProjectId) return;
    setLoadingTree(true);
    setTreeError('');
    try {
      const [projectResponse, filesResponse] = await Promise.all([
        adminFetch(`/api/admin/shared-packages/${sharedProjectId}`),
        adminFetch(`/api/admin/shared-packages/${sharedProjectId}/files`),
      ]);
      const project = projectResponse.package as SharedProjectDto;
      const files = (filesResponse.files as SharedFileDto[]) || [];
      setSharedProject(project);
      setSharedFiles(files);
      setModulesData([]);
      setUiData([]);
      setTreeData(buildSharedTree(project, files, sharedFolderOverrides));
      setSavedContents(buildSharedContentMap(files));
    } catch (err) {
      setTreeError((err as Error).message || 'Failed to load shared project');
    } finally {
      setLoadingTree(false);
    }
  }, [adminFetch, sharedFolderOverrides, sharedProjectId]);

  const loadTree = useCallback(async (overrides: FolderOverride[] = folderOverrides) => {
    setLoadingTree(true);
    setTreeError('');
    try {
      const [modules, uiPackages] = await Promise.all([
        apiFetch('/api/modules'),
        apiFetch('/api/ui-entities'),
      ]);
      const moduleItems = modules as ModuleDto[];
      const uiItems = uiPackages as UIPackageDto[];
      setModulesData(moduleItems);
      setUiData(uiItems);
      setTreeData(buildExplorerTree(moduleItems, uiItems, overrides));
      setSavedContents(buildPersistedContentMap(moduleItems, uiItems));
    } catch (err) {
      setTreeError((err as Error).message || 'Failed to load explorer');
    } finally {
      setLoadingTree(false);
    }
  }, [apiFetch, folderOverrides]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!ready || !token) return;
    if (isSharedMode) {
      loadSharedProject();
      return;
    }
    loadTree();
  }, [isSharedMode, loadSharedProject, loadTree, ready, router.isReady, token]);

  useEffect(() => {
    if (isSharedMode) return;
    if (sharedProject) setSharedProject(null);
    if (sharedFiles.length) setSharedFiles([]);
  }, [isSharedMode, sharedFiles.length, sharedProject]);

  const reloadTree = useCallback(async () => {
    if (isSharedMode) {
      await loadSharedProject();
      return;
    }
    await loadTree();
  }, [isSharedMode, loadSharedProject, loadTree]);

  useEffect(() => {
    if (!isSharedMode || !sharedProject) return;
    setTreeData(buildSharedTree(sharedProject, sharedFiles, sharedFolderOverrides));
  }, [isSharedMode, sharedFiles, sharedFolderOverrides, sharedProject]);

  useEffect(() => {
    if (!isSharedMode || !sharedProject) return;
    if (editorView !== 'preview') return;
    setPreviewTarget({
      kind: 'shared',
      name: sharedProject.name,
      version: sharedProject.version,
    });
  }, [editorView, isSharedMode, sharedProject]);

  useEffect(() => {
    if (isSharedMode) return;
    if (previewTarget) return;
    if (uiData.length === 0) return;
    const first = uiData[0];
    if (!first?.name || !first?.version) return;
    setPreviewTarget({ kind: 'ui', name: first.name, version: first.version });
  }, [isSharedMode, previewTarget, uiData]);

  useEffect(() => {
    splitRatioRef.current = splitRatio;
    if (typeof window === 'undefined') return;
    localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(splitRatio));
  }, [splitRatio]);

  useEffect(() => {
    if (rightTabs.length === 0) {
      if (sideFileId) setSideFileId(null);
      return;
    }
    if (!sideFileId || !rightPaneSet.has(sideFileId)) {
      setSideFileId(rightTabs[0].id);
    }
  }, [rightTabs, rightPaneSet, sideFileId]);

  useEffect(() => {
    if (!activeFile) return;
    if (!rightPaneSet.has(activeFile.id)) return;
    if (leftTabs.length === 0) return;
    const nextLeft = leftTabs[0] ?? null;
    setActiveFile(nextLeft);
  }, [activeFile, leftTabs, rightPaneSet]);

  useEffect(() => {
    if (openFiles.length === 0) {
      if (rightPaneIds.length > 0) setRightPaneIds([]);
      return;
    }
    setRightPaneIds((prev) => {
      const openIds = new Set(openFiles.map((file) => file.id));
      const next = prev.filter((id) => openIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [openFiles, rightPaneIds.length]);

  useEffect(() => {
    const handleWindowClick = () => setTabMenu(null);
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  useEffect(() => {
    if (!treeData) return;
    const nodeMap = new Map<string, ExplorerNode>();
    const walk = (node: ExplorerNode) => {
      nodeMap.set(node.id, node);
      if (node.type === 'folder') {
        node.children?.forEach(walk);
      }
    };
    walk(treeData);

    setOpenFiles((prev) =>
      prev
        .map((file) => {
          const node = nodeMap.get(file.id);
          if (!node || node.type !== 'file') return null;
          const meta = (node.meta as NodeMeta | undefined) ?? null;
          const language = detectLanguage(node.name);
          return { ...file, name: node.name, language, meta };
        })
        .filter(Boolean) as ActiveFile[]
    );

    setActiveFile((prev) => {
      if (!prev) return prev;
      const node = nodeMap.get(prev.id);
      if (!node || node.type !== 'file') return null;
      const meta = (node.meta as NodeMeta | undefined) ?? null;
      const language = detectLanguage(node.name);
      return { ...prev, name: node.name, language, meta };
    });
  }, [treeData]);

  useEffect(() => {
    if (!treeData) return;
    const nodeMap = new Map<string, ExplorerNode>();
    const walk = (node: ExplorerNode) => {
      nodeMap.set(node.id, node);
      if (node.type === 'folder') {
        node.children?.forEach(walk);
      }
    };
    walk(treeData);
    const candidateIds = new Set<string>();
    openFiles.forEach((file) => candidateIds.add(file.id));
    if (activeFile?.id) candidateIds.add(activeFile.id);

    setFileContents((prev) => {
      let changed = false;
      const next = { ...prev };
      candidateIds.forEach((id) => {
        if (next[id] !== undefined) return;
        const node = nodeMap.get(id);
        if (node?.type !== 'file') return;
        next[id] = savedContents[id] ?? node.content ?? '';
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [activeFile?.id, openFiles, savedContents, treeData]);


  useEffect(() => {
    setHistorySelectedId(null);
    setHistoryPage(1);
  }, [activeFile?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const container = historyListRef.current;
    if (!container) return;
    let raf = 0;
    const measure = () => {
      const height = container.getBoundingClientRect().height;
      if (height < 1) return;
      const rowHeight =
        historyRowRef.current?.getBoundingClientRect().height ?? 36;
      if (rowHeight < 1) return;
      const nextSize = Math.max(1, Math.floor(height / rowHeight));
      setHistoryPageSize((prev) => (prev === nextSize ? prev : nextSize));
    };
    measure();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [leftPanel, leftPanelOpen, historyItems.length]);

  const loadHistory = useCallback(
    async (page = historyPage) => {
    if (!activeFile?.meta) {
      setHistoryItems([]);
      setHistoryError('');
      setHistoryTotal(0);
      return;
    }
    if (activeFile.meta.kind === 'shared') {
      setHistoryItems([]);
      setHistoryError('History is not available for shared projects yet.');
      setHistoryTotal(0);
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    setHistoryError('');
    try {
      if (activeFile.meta.kind === 'module') {
        const response = (await apiFetch(
          `/api/modules/${activeFile.meta.backendId}/versions?page=${page}&limit=${historyPageSize}`
        )) as HistoryResponse<ModuleRevisionDto> | ModuleRevisionDto[];
        if (Array.isArray(response)) {
          const total = response.length;
          const start = (page - 1) * historyPageSize;
          const items = response.slice(start, start + historyPageSize);
          setHistoryItems(items.map((rev) => ({ ...rev, kind: 'module' })));
          setHistoryTotal(total);
        } else {
          const items = response.items.slice(0, historyPageSize);
          setHistoryItems(items.map((rev) => ({ ...rev, kind: 'module' })));
          setHistoryTotal(response.total);
        }
      } else {
        const response = (await apiFetch(
          `/api/ui-entities/${activeFile.meta.backendId}/versions?page=${page}&limit=${historyPageSize}`
        )) as HistoryResponse<UiRevisionDto> | UiRevisionDto[];
        if (Array.isArray(response)) {
          const total = response.length;
          const start = (page - 1) * historyPageSize;
          const items = response.slice(start, start + historyPageSize);
          setHistoryItems(items.map((rev) => ({ ...rev, kind: 'ui' })));
          setHistoryTotal(total);
        } else {
          const items = response.items.slice(0, historyPageSize);
          setHistoryItems(items.map((rev) => ({ ...rev, kind: 'ui' })));
          setHistoryTotal(response.total);
        }
      }
    } catch (err) {
      setHistoryError((err as Error).message || 'Failed to load history');
      setHistoryItems([]);
      setHistoryTotal(0);
    } finally {
      setHistoryLoading(false);
    }
  },
    [activeFile?.meta, apiFetch, historyPage, historyPageSize]
  );

  useEffect(() => {
    if (!activeFile?.meta) {
      setHistoryItems([]);
      setHistoryError('');
      setHistoryTotal(0);
      return;
    }
    loadHistory(historyPage);
  }, [activeFile?.meta, historyPage, loadHistory]);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / historyPageSize));

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  const handleOpenFile = (file: ExplorerNode) => {
    if (file.type !== 'file') return;
    const language = detectLanguage(file.name);
    const meta = (file.meta as NodeMeta | undefined) ?? null;
    const serverContent = file.content ?? '';
    const persistedContent =
      savedContents[file.id] !== undefined ? savedContents[file.id] : serverContent;
    const initialContent =
      fileContents[file.id] !== undefined ? fileContents[file.id] : persistedContent;

    setFileContents((prev) => {
      if (prev[file.id] !== undefined) return prev;
      return { ...prev, [file.id]: initialContent };
    });

    setSavedContents((prev) => {
      if (prev[file.id] !== undefined) return prev;
      return { ...prev, [file.id]: persistedContent };
    });

    setOpenFiles((prev) => {
      const existing = prev.find((f) => f.id === file.id);
      if (existing) {
        return prev.map((f) =>
          f.id === file.id ? { ...f, name: file.name, language, meta } : f
        );
      }
      return [...prev, { id: file.id, name: file.name, language, meta }];
    });

    setActiveFile({ id: file.id, name: file.name, language, meta });
  };

  const updateFileContent = useCallback((fileId: string, value?: string) => {
    if (value === undefined) return;
    setFileContents((prev) => {
      if (prev[fileId] === value) return prev;
      return { ...prev, [fileId]: value };
    });
  }, []);

  const resolveEditorFileId = useCallback(
    (
      editor: monaco.editor.IStandaloneCodeEditor | null,
      fallbackId?: string | null
    ) => {
      const path = editor?.getModel()?.uri.path;
      const fromPath = path ? getFileIdFromUriPath(path) : null;
      const candidate = fromPath ?? fallbackId ?? null;
      if (!candidate) return null;
      if (
        !candidate.startsWith('module-') &&
        !candidate.startsWith('ui-') &&
        !candidate.startsWith('shared-')
      )
        return null;
      return candidate;
    },
    []
  );

  const handleEditorChange = (
    value?: string,
    event?: monaco.editor.IModelContentChangedEvent
  ) => {
    if (value === undefined) return;
    const fileId = resolveEditorFileId(mainEditorRef.current, activeFile?.id);
    if (!fileId) return;
    if (event?.isFlush && value === '' && savedContents[fileId]) {
      return;
    }
    updateFileContent(fileId, value);
  };

  const handleLanguageChange = (language: EditorLanguage) => {
    if (!activeFile) return;
    setActiveFile({ ...activeFile, language });
    setOpenFiles((prev) =>
      prev.map((f) => (f.id === activeFile.id ? { ...f, language } : f))
    );
  };

  const handleSideEditorChange = (
    value?: string,
    event?: monaco.editor.IModelContentChangedEvent
  ) => {
    if (value === undefined) return;
    const fileId = resolveEditorFileId(sideEditorRef.current, sideFile?.id);
    if (!fileId) return;
    if (!rightPaneSet.has(fileId)) return;
    if (event?.isFlush && value === '' && savedContents[fileId]) {
      return;
    }
    updateFileContent(fileId, value);
  };

  const searchPattern = useMemo(
    () =>
      buildSearchPattern(searchQuery, searchMatchCase, searchWholeWord, searchUseRegex),
    [searchMatchCase, searchQuery, searchUseRegex, searchWholeWord]
  );

  const clearSearchDecorations = useCallback(() => {
    const editor = mainEditorRef.current;
    if (!editor) return;
    searchDecorationsRef.current = editor.deltaDecorations(
      searchDecorationsRef.current,
      []
    );
  }, []);

  const applySearchDecorations = useCallback(
    (range?: SearchMatchRange) => {
      const editor = mainEditorRef.current;
      const model = editor?.getModel();
      if (!editor || !model || !searchQuery.trim() || searchPattern.error) {
        clearSearchDecorations();
        return;
      }
      const matches = model.findMatches(
        searchPattern.source,
        false,
        searchPattern.isRegex,
        searchMatchCase,
        null,
        true
      );
      const decorations: monaco.editor.IModelDeltaDecoration[] = matches.map(
        (match) => ({
          range: match.range,
          options: { inlineClassName: 'monaco-search-match' },
      })
      );
      if (range) {
        decorations.push({
          range,
          options: { inlineClassName: 'monaco-search-current' },
        });
      }
      searchDecorationsRef.current = editor.deltaDecorations(
        searchDecorationsRef.current,
        decorations
      );
    },
    [clearSearchDecorations, searchMatchCase, searchPattern, searchQuery]
  );

  const moveTabToPane = useCallback(
    (id: string, pane: 'left' | 'right') => {
      setRightPaneIds((prev) => {
        const exists = prev.includes(id);
        if (pane === 'right' && !exists) return [...prev, id];
        if (pane === 'left' && exists) return prev.filter((item) => item !== id);
        return prev;
      });
      if (pane === 'right') {
        setSideFileId(id);
      } else if (sideFileId === id) {
        setSideFileId(null);
      }
    },
    [sideFileId]
  );

  const removeFileEntries = useCallback((ids: Set<string>) => {
    if (ids.size === 0) return;
    setFileContents((prev) => {
      let changed = false;
      const next = { ...prev };
      ids.forEach((id) => {
        if (next[id] !== undefined) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const closeTabsByIds = useCallback(
    (ids: Set<string>) => {
      if (ids.size === 0) return;
      removeFileEntries(ids);
      setSideFileId((prev) => (prev && ids.has(prev) ? null : prev));
      setRightPaneIds((prev) => prev.filter((item) => !ids.has(item)));
      setOpenFiles((prev) => {
        const next = prev.filter((file) => !ids.has(file.id));
        if (activeFile && ids.has(activeFile.id)) {
          if (next.length === 0) {
            setActiveFile(null);
            return next;
          }
          const prevIndex = prev.findIndex((file) => file.id === activeFile.id);
          const fallbackIndex = Math.min(
            Math.max(prevIndex, 0),
            Math.max(next.length - 1, 0)
          );
          setActiveFile(next[fallbackIndex] ?? next[next.length - 1] ?? null);
        }
        return next;
      });
    },
    [activeFile, removeFileEntries]
  );

  const isFileDirty = useCallback(
    (file: ActiveFile) => {
      const current =
        fileContents[file.id] ?? savedContents[file.id] ?? '';
      const saved = savedContents[file.id];
      if (saved === undefined) return false;
      return current !== saved;
    },
    [fileContents, savedContents]
  );

  const dirtyFileIds = useMemo(
    () => new Set(openFiles.filter(isFileDirty).map((file) => file.id)),
    [isFileDirty, openFiles]
  );

  const sharedDirty = useMemo(
    () => openFiles.some((file) => file.meta?.kind === 'shared' && isFileDirty(file)),
    [isFileDirty, openFiles]
  );

  const stagingItems = useMemo(() => {
    const items: StagingItem[] = [];
    modulesData.forEach((mod) => {
      const fileId = `module-${mod.id}`;
      items.push({
        id: fileId,
        kind: 'module',
        title: `${mod.method} ${mod.routePath}`,
        draftVersion: mod.draftVersion,
        publishedVersion: mod.publishedVersion,
        publishedAt: mod.publishedAt,
        backendId: mod.id,
        fileId,
        dirty: dirtyFileIds.has(fileId),
      });
    });
    uiData.forEach((pkg) => {
      const fileId = `ui-${pkg.id}`;
      items.push({
        id: fileId,
        kind: 'ui',
        title: pkg.name,
        draftVersion: pkg.draftVersion,
        publishedVersion: pkg.publishedVersion,
        publishedAt: pkg.publishedAt,
        backendId: pkg.id,
        fileId,
        dirty: dirtyFileIds.has(fileId),
      });
    });
    if (isSharedMode && sharedProject) {
      items.push({
        id: `shared-project-${sharedProject.id}`,
        kind: 'shared',
        title: sharedProject.name,
        draftVersion: sharedProject.draftVersion,
        publishedVersion: sharedProject.publishedVersion,
        publishedAt: sharedProject.publishedAt,
        projectId: sharedProject.id,
        dirty: sharedDirty,
      });
    }
    items.sort((a, b) => a.title.localeCompare(b.title));
    return items;
  }, [dirtyFileIds, isSharedMode, modulesData, sharedDirty, sharedProject, uiData]);

  const stagingCounts = useMemo(() => {
    const total = stagingItems.length;
    const published = stagingItems.filter((item) => item.publishedVersion).length;
    return { total, published, drafts: total - published };
  }, [stagingItems]);

  const requestCloseTabs = useCallback(
    (ids: Set<string>) => {
      if (ids.size === 0) return;
      const dirtyFiles = openFiles.filter(
        (file) => ids.has(file.id) && isFileDirty(file)
      );
      if (dirtyFiles.length === 0) {
        closeTabsByIds(ids);
        return;
      }
      setPendingCloseIds(Array.from(ids));
      setPendingCloseAction('close');
      setClosePromptOpen(true);
    },
    [closeTabsByIds, isFileDirty, openFiles]
  );

  const requestReload = useCallback(() => {
    const dirtyFiles = openFiles.filter(isFileDirty);
    if (dirtyFiles.length === 0) {
      window.location.reload();
      return;
    }
    setPendingCloseIds(openFiles.map((file) => file.id));
    setPendingCloseAction('reload');
    setClosePromptOpen(true);
  }, [isFileDirty, openFiles]);

  const pendingDirtyFiles = useMemo(() => {
    if (pendingCloseIds.length === 0) return [];
    const idSet = new Set(pendingCloseIds);
    return openFiles.filter((file) => idSet.has(file.id) && isFileDirty(file));
  }, [isFileDirty, openFiles, pendingCloseIds]);

  const handleTabDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    id: string
  ) => {
    dragTabIdRef.current = id;
    event.dataTransfer.setData('application/x-editor-tab', id);
    event.dataTransfer.setData('text/plain', '');
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleTabDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const getDraggedTabId = (event: React.DragEvent<HTMLDivElement>) =>
    dragTabIdRef.current ||
    event.dataTransfer.getData('application/x-editor-tab') ||
    event.dataTransfer.getData('text/plain');

  const handleTabDrop = (
    event: React.DragEvent<HTMLDivElement>,
    id: string,
    pane: 'left' | 'right'
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = getDraggedTabId(event);
    dragTabIdRef.current = null;
    if (!sourceId || sourceId === id) return;
    setOpenFiles((prev) => {
      const fromIndex = prev.findIndex((file) => file.id === sourceId);
      const toIndex = prev.findIndex((file) => file.id === id);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    moveTabToPane(sourceId, pane);
  };

  const handleTabDragEnd = () => {
    dragTabIdRef.current = null;
  };

  const handleTabBarDrop = (
    event: React.DragEvent<HTMLDivElement>,
    pane: 'left' | 'right'
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = getDraggedTabId(event);
    dragTabIdRef.current = null;
    if (!sourceId) return;
    moveTabToPane(sourceId, pane);
  };

  const handleEditorDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = getDraggedTabId(event);
    dragTabIdRef.current = null;
    if (!sourceId || !editorAreaRef.current) return;
    const rect = editorAreaRef.current.getBoundingClientRect();
    const isRightSide = event.clientX > rect.left + rect.width * 0.55;
    moveTabToPane(sourceId, isRightSide ? 'right' : 'left');
  };

  const syncSharedPackage = useCallback(
    async (
      project: SharedProjectDto,
      files: SharedFileDto[],
      entryPathOverride?: string
    ) => {
      const normalizedEntry = normalizeSharedPath(
        entryPathOverride ?? project.entryPath ?? ''
      );
      if (!normalizedEntry) {
        throw new Error('Shared project entry path is missing.');
      }
      const entryFile = files.find(
        (file) => normalizeSharedPath(file.path) === normalizedEntry
      );
      if (!entryFile) {
        throw new Error(`Entry file not found: ${normalizedEntry}`);
      }
      const entrySource = entryFile.content ?? '';
      const entryExtension = resolveSharedExtension(
        normalizedEntry,
        entryFile.fileExtension
      );
      const bundle = buildSharedBundle({ ...project, entryPath: normalizedEntry }, files);
      await adminFetch(`/api/admin/shared-packages/${project.id}`, {
        method: 'PUT',
        body: {
          name: project.name,
          version: project.version,
          entryPath: normalizedEntry,
          code: entrySource,
          codeBlob: bundle,
          dependencies: project.dependencies ?? [],
          fileExtension: entryExtension,
        },
      });
      return { ...project, entryPath: normalizedEntry };
    },
    [adminFetch]
  );

  const saveFile = useCallback(
    async (file: ActiveFile) => {
      const meta = file.meta;
      if (!meta) return;
      const content = fileContents[file.id] ?? savedContents[file.id] ?? '';
      if (meta.kind === 'shared') {
        if (!sharedProject) {
          throw new Error('Shared project is not loaded.');
        }
        const projectId = meta.projectId || sharedProject.id;
        await adminFetch(
          `/api/admin/shared-packages/${projectId}/files/${meta.fileId}`,
          {
            method: 'PUT',
            body: {
              path: meta.path,
              content,
              fileExtension: meta.fileExtension,
            },
          }
        );
        const currentSaved = savedContentsRef.current;
        const currentFiles = sharedFilesRef.current;
        const nextSaved = { ...currentSaved, [file.id]: content };
        const nextFiles = currentFiles.map((item) =>
          item.id === meta.fileId ? { ...item, content } : item
        );
        const nextProject = await syncSharedPackage(sharedProject, nextFiles);
        savedContentsRef.current = nextSaved;
        sharedFilesRef.current = nextFiles;
        setSharedProject(nextProject);
        setSharedFiles(nextFiles);
        setSavedContents(nextSaved);
        return;
      }
      if (meta.kind === 'module') {
        await apiFetch(`/api/modules/${meta.backendId}`, {
          method: 'PUT',
          body: {
            routePath: meta.routePath,
            method: meta.method,
            code: content,
            fileExtension: coerceModuleExtension(meta.fileExtension),
          },
        });
      } else {
        const uiExtension = coerceUiExtension(meta.fileExtension);
        if (uiExtension !== 'css' && !window.Babel) {
          throw new Error('Babel runtime not loaded in browser; cannot build code_blob');
        }
        const compiled = uiExtension === 'css' ? content : compileWithBabel(content);
        await apiFetch(`/api/ui-entities/${meta.backendId}`, {
          method: 'PUT',
          body: {
            name: meta.name,
            version: meta.version,
            code: content,
            codeBlob: compiled,
            dependencies: meta.dependencies ?? [],
            fileExtension: uiExtension,
          },
        });
      }
      setSavedContents((prev) => ({ ...prev, [file.id]: content }));
    },
    [
      adminFetch,
      apiFetch,
      fileContents,
      sharedProject,
      syncSharedPackage,
    ]
  );

  const handleSaveFile = useCallback(
    async (file: ActiveFile) => {
      if (!file.meta) return;
      try {
        await saveFile(file);
        success('Saved');
        await reloadTree();
        if (activeFile?.id === file.id && file.meta.kind !== 'shared') {
          loadHistory();
        }
      } catch (err) {
        showError((err as Error).message || 'Save failed');
      }
    },
    [activeFile?.id, loadHistory, reloadTree, saveFile, showError, success]
  );

  const handleSaveAll = useCallback(async () => {
    if (openFiles.length === 0) return;
    const dirtyFiles = openFiles.filter(isFileDirty);
    if (dirtyFiles.length === 0) {
      success('Nothing to save');
      return;
    }
    let firstError: string | null = null;
    let savedActive = false;
    for (const file of dirtyFiles) {
      try {
        await saveFile(file);
        if (activeFile?.id === file.id) savedActive = true;
      } catch (err) {
        if (!firstError) {
          firstError = (err as Error).message || 'Save failed';
        }
      }
    }
    if (firstError) {
      showError(firstError);
    } else {
      success('Saved all');
    }
    await reloadTree();
    if (savedActive && activeFile?.meta?.kind !== 'shared') {
      loadHistory();
    }
  }, [
    activeFile?.id,
    activeFile?.meta?.kind,
    isFileDirty,
    loadHistory,
    reloadTree,
    openFiles,
    saveFile,
    showError,
    success,
  ]);

  const publishTarget = useCallback(
    async (target: StagingItem) => {
      if (stagingBusy) return;
      try {
        setStagingBusy(true);
        setStagingBusyId(target.id);
        if (target.kind === 'module') {
          if (!target.backendId) {
            throw new Error('Module id is missing.');
          }
          await apiFetch(`/api/modules/${target.backendId}/publish`, { method: 'POST' });
          success('Module published');
          await reloadTree();
          return;
        }
        if (target.kind === 'ui') {
          if (!target.backendId) {
            throw new Error('UI entity id is missing.');
          }
          await apiFetch(`/api/ui-entities/${target.backendId}/publish`, { method: 'POST' });
          success('UI entity published');
          await reloadTree();
          return;
        }
        const projectId = target.projectId || sharedProject?.id;
        if (!projectId) {
          throw new Error('Shared project is not loaded.');
        }
        await adminFetch(`/api/admin/shared-packages/${projectId}/publish`, {
          method: 'POST',
        });
        const refreshed = await adminFetch(`/api/admin/shared-packages/${projectId}`);
        setSharedProject(refreshed.package ?? refreshed);
        success('Shared project published');
      } catch (err) {
        showError((err as Error).message || 'Publish failed');
      } finally {
        setStagingBusy(false);
        setStagingBusyId(null);
      }
    },
    [adminFetch, apiFetch, reloadTree, sharedProject?.id, showError, stagingBusy, success]
  );

  const handleCloseFile = (id: string) => {
    requestCloseTabs(new Set([id]));
  };

  const handleResizeStart = (event: React.MouseEvent) => {
    resizeRef.current = {
      active: true,
      startX: event.clientX,
      startWidth: leftPanelWidthRef.current,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleSplitResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    splitResizeRef.current.active = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleSave = useCallback(() => {
    if (!activeFile) return;
    void handleSaveFile(activeFile);
  }, [activeFile, handleSaveFile]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        target &&
        (target.isContentEditable ||
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select')
      ) {
        // Allow modifier shortcuts even while typing, but ignore plain keys.
      }

      const key = event.key.toLowerCase();
      if (key === 'f5') {
        event.preventDefault();
        requestReload();
        return;
      }

      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) return;

      if (key === 's') {
        event.preventDefault();
        if (activeFile) {
          handleSave();
        }
        return;
      }

      if (key === 'r' && event.shiftKey) {
        event.preventDefault();
        reloadTree();
        loadHistory();
        return;
      }

      if (key === 'r') {
        event.preventDefault();
        requestReload();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeFile, handleSave, loadHistory, reloadTree, requestReload]);


  const resetActionFeedback = () => {};

  const openCreateModal = (
    scope: PanelScope,
    type: 'file' | 'folder',
    parentPath: string[]
  ) => {
    resetActionFeedback();
    setCreateScope(scope);
    setCreateType(type);
    setCreateParentPath(parentPath);
    if (scope === 'shared') {
      if (type === 'file') {
        const ext = sharedProject?.fileExtension || 'tsx';
        const base = parentPath.length ? `${parentPath.join('/')}/` : '';
        setSharedFileForm({
          path: `${base}new-file.${ext}`,
          content: '',
        });
      } else {
        setFolderForm({ name: '' });
      }
      setCreateModalOpen(true);
      return;
    }
    if (type === 'file') {
      if (scope === 'modules') {
        const routePath = buildRoutePath(parentPath);
        setModuleForm({
          routePath,
          method: 'GET',
          fileExtension: MODULE_EXTENSION,
          code: DEFAULT_MODULE_CODE,
        });
      } else {
        const prefix = parentPath.length ? `${parentPath.join('/')}/` : '';
        setUiForm({
          name: `${prefix}NewComponent`,
          version: '1.0.0',
          fileExtension: DEFAULT_UI_EXTENSION,
          dependencies: '',
          code: DEFAULT_UI_CODE,
        });
      }
    } else {
      setFolderForm({ name: '' });
    }
    setCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setCreateModalOpen(false);
    setCreateScope(null);
    setCreateType(null);
    setCreateParentPath([]);
    setFolderForm({ name: '' });
    setSharedFileForm(DEFAULT_SHARED_FILE);
  };

  const handleCreateSubmit = async () => {
    if (!createScope || !createType) return;
    resetActionFeedback();
    if (createScope === 'shared') {
      if (!sharedProjectId) {
        showError('Shared project is not loaded.');
        return;
      }
      if (createType === 'folder') {
        const name = folderForm.name.trim();
        if (!name || /[\\/]/.test(name)) {
          showError('Folder name cannot be empty or contain slashes.');
          return;
        }
        const nextPath = [...createParentPath, name];
        const exists = sharedFolderOverrides.some(
          (item) => item.join('/') === nextPath.join('/')
        );
        const nextOverrides = exists
          ? sharedFolderOverrides
          : [...sharedFolderOverrides, nextPath];
        setSharedFolderOverrides(nextOverrides);
        if (sharedProject) {
          setTreeData(buildSharedTree(sharedProject, sharedFiles, nextOverrides));
        }
        success('Folder created');
        closeCreateModal();
        return;
      }

      const normalizedPath = normalizeSharedPath(sharedFileForm.path);
      if (!normalizedPath) {
        showError('File path is required.');
        return;
      }
      const duplicate = sharedFiles.some(
        (file) => normalizeSharedPath(file.path) === normalizedPath
      );
      if (duplicate) {
        showError('File already exists at this path.');
        return;
      }
      try {
        const content = sharedFileForm.content ?? '';
        await adminFetch(`/api/admin/shared-packages/${sharedProjectId}/files`, {
          method: 'POST',
          body: {
            path: normalizedPath,
            content,
            fileExtension: resolveSharedExtension(normalizedPath),
          },
        });
        success('File created');
        closeCreateModal();
        await reloadTree();
      } catch (err) {
        const message = (err as Error).message || 'Failed to create file';
        showError(message);
      }
      return;
    }
    if (createType === 'folder') {
      const name = folderForm.name.trim();
      if (!name || /[\\/]/.test(name)) {
        showError('Folder name cannot be empty or contain slashes.');
        return;
      }
      const nextPath = [...createParentPath, name];
      const nextOverrides = folderOverrides.some(
        (item) =>
          item.scope === createScope && item.path.join('/') === nextPath.join('/')
      )
        ? folderOverrides
        : [...folderOverrides, { scope: createScope, path: nextPath }];
      setFolderOverrides(nextOverrides);
      setTreeData(buildExplorerTree(modulesData, uiData, nextOverrides));
      success('Folder created');
      closeCreateModal();
      return;
    }

    if (createScope === 'modules') {
      if (!moduleForm.routePath.trim()) {
        showError('Route path is required.');
        return;
      }
      if (!moduleForm.method) {
        showError('Method is required.');
        return;
      }
      try {
        await apiFetch('/api/modules', {
          method: 'POST',
          body: {
            routePath: moduleForm.routePath,
            method: moduleForm.method,
            code: moduleForm.code || DEFAULT_MODULE_CODE,
            fileExtension: MODULE_EXTENSION,
          },
        });
        success('Module created');
        closeCreateModal();
        await loadTree();
      } catch (err) {
        const message = (err as Error).message || 'Failed to create module';
        showError(message);
      }
      return;
    }

    if (!uiForm.name.trim() || !uiForm.version.trim()) {
      showError('Name and version are required.');
      return;
    }
    const uiExtension = coerceUiExtension(uiForm.fileExtension);
    if (uiExtension !== 'css' && !window.Babel) {
      showError('Babel runtime not loaded in browser; cannot build code_blob.');
      return;
    }
    try {
      const fallbackSource = uiExtension === 'css' ? DEFAULT_CSS_CODE : DEFAULT_UI_CODE;
      const sourceCode = uiForm.code || fallbackSource;
      const compiled = uiExtension === 'css' ? sourceCode : compileWithBabel(sourceCode);
      await apiFetch('/api/ui-entities', {
        method: 'POST',
        body: {
          name: uiForm.name,
          version: uiForm.version,
          code: sourceCode,
          codeBlob: compiled,
          dependencies: parseDependencies(uiForm.dependencies),
          fileExtension: uiExtension,
        },
      });
      success('UI entity created');
      closeCreateModal();
      await loadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to create UI entity';
      showError(message);
    }
  };

  const openEditModal = (meta: NodeMeta) => {
    resetActionFeedback();
    setEditMeta(meta);
    if (meta.kind === 'shared') {
      setEditSharedPath(meta.path);
    } else if (meta.kind === 'module') {
      setEditModuleForm({
        routePath: meta.routePath,
        method: meta.method,
        fileExtension: coerceModuleExtension(meta.fileExtension),
        code: '',
      });
    } else {
      setEditUiForm({
        name: meta.name,
        version: meta.version,
        fileExtension: coerceUiExtension(meta.fileExtension),
        dependencies: (meta.dependencies || []).join(', '),
        code: '',
      });
    }
    setEditModalOpen(true);
  };

  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditMeta(null);
    setEditSharedPath('');
  };

  const handleEditSubmit = async () => {
    if (!editMeta) return;
    resetActionFeedback();
    if (editMeta.kind === 'shared') {
      if (!sharedProject) {
        showError('Shared project is not loaded.');
        return;
      }
      const normalizedPath = normalizeSharedPath(editSharedPath);
      if (!normalizedPath) {
        showError('File path is required.');
        return;
      }
      const duplicate = sharedFiles.some(
        (file) =>
          file.id !== editMeta.fileId &&
          normalizeSharedPath(file.path) === normalizedPath
      );
      if (duplicate) {
        showError('File already exists at this path.');
        return;
      }
      try {
        await adminFetch(
          `/api/admin/shared-packages/${sharedProject.id}/files/${editMeta.fileId}`,
          {
            method: 'PUT',
            body: {
              path: normalizedPath,
              fileExtension: resolveSharedExtension(
                normalizedPath,
                editMeta.fileExtension
              ),
            },
          }
        );
        const nextFiles = sharedFiles.map((file) =>
          file.id === editMeta.fileId ? { ...file, path: normalizedPath } : file
        );
        const entryPath = normalizeSharedPath(sharedProject.entryPath || '');
        const nextProject =
          normalizeSharedPath(editMeta.path) === entryPath
            ? { ...sharedProject, entryPath: normalizedPath }
            : sharedProject;
        const updatedProject = await syncSharedPackage(nextProject, nextFiles);
        setSharedProject(updatedProject);
        setSharedFiles(nextFiles);
        sharedFilesRef.current = nextFiles;
        success('File updated');
        closeEditModal();
        await reloadTree();
      } catch (err) {
        const message = (err as Error).message || 'Failed to update file';
        showError(message);
      }
      return;
    }
    if (editMeta.kind === 'module') {
      if (!editModuleForm.routePath.trim()) {
        showError('Route path is required.');
        return;
      }
      if (!editModuleForm.method) {
        showError('Method is required.');
        return;
      }
      try {
        await apiFetch(`/api/modules/${editMeta.backendId}`, {
          method: 'PUT',
          body: {
            routePath: editModuleForm.routePath,
            method: editModuleForm.method,
            fileExtension: MODULE_EXTENSION,
          },
        });
        success('Module updated');
        closeEditModal();
        await loadTree();
      } catch (err) {
        const message = (err as Error).message || 'Failed to update module';
        showError(message);
      }
      return;
    }

    if (!editUiForm.name.trim() || !editUiForm.version.trim()) {
      showError('Name and version are required.');
      return;
    }
    try {
      const uiExtension = coerceUiExtension(editUiForm.fileExtension);
      await apiFetch(`/api/ui-entities/${editMeta.backendId}`, {
        method: 'PUT',
        body: {
          name: editUiForm.name,
          version: editUiForm.version,
          dependencies: parseDependencies(editUiForm.dependencies),
          fileExtension: uiExtension,
        },
      });
      success('UI entity updated');
      closeEditModal();
      await loadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to update UI entity';
      showError(message);
    }
  };

  const openRenameFolderModal = (scope: PanelScope, path: string[]) => {
    resetActionFeedback();
    const name = path[path.length - 1] || '';
    setRenameFolderScope(scope);
    setRenameFolderPath(path);
    setRenameFolderName(name);
    setRenameFolderOpen(true);
  };

  const closeRenameFolderModal = () => {
    setRenameFolderOpen(false);
    setRenameFolderScope(null);
    setRenameFolderPath([]);
    setRenameFolderName('');
  };

  const handleRenameFolderSubmit = async () => {
    if (!renameFolderScope || !renameFolderPath.length) return;
    const newName = renameFolderName.trim();
    if (!newName || /[\\/]/.test(newName)) {
      showError('Folder name cannot be empty or contain slashes.');
      return;
    }
    const oldPath = renameFolderPath;
    const newPath = [...oldPath.slice(0, -1), newName];

    resetActionFeedback();
    try {
      if (renameFolderScope === 'shared') {
        if (!sharedProject) {
          showError('Shared project is not loaded.');
          return;
        }
        const updates = sharedFiles.filter((file) =>
          pathStartsWith(splitSharedPath(file.path), oldPath)
        );
        await Promise.all(
          updates.map((file) => {
            const segments = splitSharedPath(file.path);
            const remainder = segments.slice(oldPath.length);
            const nextPath = normalizeSharedPath([...newPath, ...remainder].join('/'));
            return adminFetch(
              `/api/admin/shared-packages/${sharedProject.id}/files/${file.id}`,
              { method: 'PUT', body: { path: nextPath } }
            );
          })
        );
        const nextFiles = sharedFiles.map((file) => {
          if (!pathStartsWith(splitSharedPath(file.path), oldPath)) return file;
          const segments = splitSharedPath(file.path);
          const remainder = segments.slice(oldPath.length);
          return {
            ...file,
            path: normalizeSharedPath([...newPath, ...remainder].join('/')),
          };
        });
        const nextOverrides = sharedFolderOverrides.map((path) => {
          if (!pathStartsWith(path, oldPath)) return path;
          const remainder = path.slice(oldPath.length);
          return [...newPath, ...remainder];
        });
        setSharedFolderOverrides(nextOverrides);
        const entrySegments = splitSharedPath(sharedProject.entryPath || '');
        const nextProject = pathStartsWith(entrySegments, oldPath)
          ? {
              ...sharedProject,
              entryPath: normalizeSharedPath(
                [...newPath, ...entrySegments.slice(oldPath.length)].join('/')
              ),
            }
          : sharedProject;
        const updatedProject = await syncSharedPackage(nextProject, nextFiles);
        setSharedProject(updatedProject);
        setSharedFiles(nextFiles);
        sharedFilesRef.current = nextFiles;
        success('Folder updated');
        closeRenameFolderModal();
        await reloadTree();
        return;
      } else if (renameFolderScope === 'modules') {
        const updates = modulesData.filter((mod) =>
          pathStartsWith(splitRoutePath(mod.routePath || '/'), oldPath)
        );
        await Promise.all(
          updates.map((mod) => {
            const segments = splitRoutePath(mod.routePath || '/');
            const remainder = segments.slice(oldPath.length);
            const nextRoute = buildRoutePath([...newPath, ...remainder]);
            return apiFetch(`/api/modules/${mod.id}`, {
              method: 'PUT',
              body: { routePath: nextRoute, method: mod.method, fileExtension: MODULE_EXTENSION },
            });
          })
        );
      } else {
        const updates = uiData.filter((pkg) =>
          pathStartsWith(splitUiName(pkg.name || ''), oldPath)
        );
        await Promise.all(
          updates.map((pkg) => {
            const segments = splitUiName(pkg.name || '');
            const remainder = segments.slice(oldPath.length);
            const nextName = buildUiName([...newPath, ...remainder]);
            return apiFetch(`/api/ui-entities/${pkg.id}`, {
              method: 'PUT',
              body: {
                name: nextName,
                version: pkg.version,
                dependencies: pkg.dependencies ?? [],
                fileExtension: coerceUiExtension(pkg.fileExtension),
              },
            });
          })
        );
      }
      const nextOverrides = folderOverrides.map((item) => {
        if (item.scope !== renameFolderScope) return item;
        if (!pathStartsWith(item.path, oldPath)) return item;
        const remainder = item.path.slice(oldPath.length);
        return { scope: renameFolderScope, path: [...newPath, ...remainder] };
      });
      setFolderOverrides(nextOverrides);
      success('Folder updated');
      closeRenameFolderModal();
      await loadTree(nextOverrides);
    } catch (err) {
      const message = (err as Error).message || 'Failed to rename folder';
      showError(message);
    }
  };

  const openDeleteModal = (
    target:
      | { type: 'file'; scope: PanelScope; meta: NodeMeta; label: string }
      | { type: 'folder'; scope: PanelScope; path: string[]; label: string }
  ) => {
    resetActionFeedback();
    setDeleteTarget(target);
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
    setDeleteTarget(null);
  };

  const handleDeleteSubmit = async () => {
    if (!deleteTarget) return;
    resetActionFeedback();
    try {
      if (deleteTarget.type === 'file') {
        const meta = deleteTarget.meta;
        if (meta.kind === 'shared') {
          if (!sharedProject) {
            showError('Shared project is not loaded.');
            return;
          }
          const entryPath = normalizeSharedPath(sharedProject.entryPath || '');
          if (normalizeSharedPath(meta.path) === entryPath) {
            showError('Cannot delete the entry file. Update entry path first.');
            return;
          }
          await adminFetch(
            `/api/admin/shared-packages/${sharedProject.id}/files/${meta.fileId}`,
            { method: 'DELETE' }
          );
          const nextFiles = sharedFiles.filter((file) => file.id !== meta.fileId);
          const nextSaved = { ...savedContents };
          const nodeId = getSharedNodeId(meta.fileId);
          delete nextSaved[nodeId];
          setSavedContents(nextSaved);
          savedContentsRef.current = nextSaved;
          removeFileEntries(new Set([nodeId]));
          const updatedProject = await syncSharedPackage(sharedProject, nextFiles);
          setSharedProject(updatedProject);
          setSharedFiles(nextFiles);
          sharedFilesRef.current = nextFiles;
          success('File deleted');
          closeDeleteModal();
          await reloadTree();
          return;
        }
        if (meta.kind === 'module') {
          await apiFetch(`/api/modules/${meta.backendId}`, { method: 'DELETE' });
        } else {
          await apiFetch(`/api/ui-entities/${meta.backendId}`, { method: 'DELETE' });
        }
        success('File deleted');
      } else {
        if (deleteTarget.scope === 'shared') {
          if (!sharedProject) {
            showError('Shared project is not loaded.');
            return;
          }
          const entryPath = normalizeSharedPath(sharedProject.entryPath || '');
          const removals = sharedFiles.filter((file) =>
            pathStartsWith(splitSharedPath(file.path), deleteTarget.path)
          );
          if (
            removals.some(
              (file) => normalizeSharedPath(file.path) === entryPath
            )
          ) {
            showError('Cannot delete the folder containing the entry file.');
            return;
          }
          await Promise.all(
            removals.map((file) =>
              adminFetch(
                `/api/admin/shared-packages/${sharedProject.id}/files/${file.id}`,
                { method: 'DELETE' }
              )
            )
          );
          const nextFiles = sharedFiles.filter(
            (file) =>
              !pathStartsWith(splitSharedPath(file.path), deleteTarget.path)
          );
          const nextOverrides = sharedFolderOverrides.filter(
            (path) => !pathStartsWith(path, deleteTarget.path)
          );
          setSharedFolderOverrides(nextOverrides);
          const removeIds = new Set(
            removals.map((file) => getSharedNodeId(file.id))
          );
          const nextSaved = { ...savedContents };
          removeIds.forEach((id) => delete nextSaved[id]);
          setSavedContents(nextSaved);
          savedContentsRef.current = nextSaved;
          removeFileEntries(removeIds);
          if (nextFiles.length > 0) {
            const updatedProject = await syncSharedPackage(sharedProject, nextFiles);
            setSharedProject(updatedProject);
          }
          setSharedFiles(nextFiles);
          sharedFilesRef.current = nextFiles;
          success('Folder deleted');
          closeDeleteModal();
          await reloadTree();
          return;
        }
        if (deleteTarget.scope === 'modules') {
          const removals = modulesData.filter((mod) =>
            pathStartsWith(splitRoutePath(mod.routePath || '/'), deleteTarget.path)
          );
          await Promise.all(
            removals.map((mod) =>
              apiFetch(`/api/modules/${mod.id}`, { method: 'DELETE' })
            )
          );
        } else {
          const removals = uiData.filter((pkg) =>
            pathStartsWith(splitUiName(pkg.name || ''), deleteTarget.path)
          );
          await Promise.all(
            removals.map((pkg) =>
              apiFetch(`/api/ui-entities/${pkg.id}`, { method: 'DELETE' })
            )
          );
        }
        const nextOverrides = folderOverrides.filter(
          (item) =>
            item.scope !== deleteTarget.scope ||
            !pathStartsWith(item.path, deleteTarget.path)
        );
        setFolderOverrides(nextOverrides);
        success('Folder deleted');
        closeDeleteModal();
        await loadTree(nextOverrides);
        return;
      }
      closeDeleteModal();
      await loadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to delete';
      showError(message);
    }
  };

  const handleCreateRequest = useCallback(
    ({
      type,
      parentPath,
    }: {
      type: 'file' | 'folder';
      parentPath: ExplorerNode[];
    }) => {
      if (isSharedMode) {
        const sharedPath = getSharedPathFromNodes(parentPath);
        openCreateModal('shared', type, sharedPath);
        return true;
      }
      const scopeInfo = getScopeInfo(parentPath);
      if (!scopeInfo.scope) {
        const message = 'Create items inside Modules or UI Entities.';
        showError(message);
        return true;
      }
      openCreateModal(scopeInfo.scope, type, scopeInfo.path);
      return true;
    },
    [isSharedMode, openCreateModal, showError]
  );

  const handleRenameRequest = useCallback(
    ({
      node,
      parentPath,
    }: {
      node: ExplorerNode;
      parentPath: ExplorerNode[];
    }) => {
      if (isSharedMode) {
        if (node.id === 'root') return true;
        if (node.type === 'file') {
          const meta = node.meta as NodeMeta | undefined;
          if (!meta) return true;
          openEditModal(meta);
          return true;
        }
        const sharedPath = getSharedPathFromNodes([...parentPath, node]);
        if (sharedPath.length === 0) return true;
        openRenameFolderModal('shared', sharedPath);
        return true;
      }
      const scopeInfo = getScopeInfo([...parentPath, node]);
      if (!scopeInfo.scope) return true;
      if (node.type === 'file') {
        const meta = node.meta as NodeMeta | undefined;
        if (!meta) return true;
        openEditModal(meta);
        return true;
      }
      if (node.id === 'modules-root' || node.id === 'ui-root') {
        return true;
      }
      openRenameFolderModal(scopeInfo.scope, scopeInfo.path);
      return true;
    },
    [isSharedMode, openEditModal, openRenameFolderModal]
  );

  const handleDeleteRequest = useCallback(
    ({
      node,
      parentPath,
    }: {
      node: ExplorerNode;
      parentPath: ExplorerNode[];
    }) => {
      if (isSharedMode) {
        if (node.id === 'root') return true;
        if (node.type === 'file') {
          const meta = node.meta as NodeMeta | undefined;
          if (!meta) return true;
          openDeleteModal({
            type: 'file',
            scope: 'shared',
            meta,
            label: node.name,
          });
          return true;
        }
        const sharedPath = getSharedPathFromNodes([...parentPath, node]);
        if (!sharedPath.length) return true;
        openDeleteModal({
          type: 'folder',
          scope: 'shared',
          path: sharedPath,
          label: node.name,
        });
        return true;
      }
      const scopeInfo = getScopeInfo([...parentPath, node]);
      if (!scopeInfo.scope) return true;
      if (node.type === 'file') {
        const meta = node.meta as NodeMeta | undefined;
        if (!meta) return true;
        openDeleteModal({
          type: 'file',
          scope: scopeInfo.scope,
          meta,
          label: node.name,
        });
        return true;
      }
      if (node.id === 'modules-root' || node.id === 'ui-root') {
        return true;
      }
      openDeleteModal({
        type: 'folder',
        scope: scopeInfo.scope,
        path: scopeInfo.path,
        label: node.name,
      });
      return true;
    },
    [isSharedMode, openDeleteModal]
  );

  const handleMoveRequest = useCallback(
    ({
      node,
      targetId,
      position,
      parentPath,
    }: {
      node: ExplorerNode;
      targetId: string;
      position: 'inside' | 'before' | 'after';
      parentPath: ExplorerNode[];
    }) => {
      if (isSharedMode) {
        if (!treeData || !sharedProject) return true;
        const targetPath = findPathById(treeData, targetId);
        if (!targetPath.length) return true;
        const targetParentPath =
          position === 'inside' ? targetPath : targetPath.slice(0, -1);
        const targetSegments = getSharedPathFromNodes(targetParentPath);

        if (node.type === 'file') {
          const meta = node.meta as NodeMeta | undefined;
          if (!meta || meta.kind !== 'shared') return true;
          const newPath = normalizeSharedPath(
            [...targetSegments, node.name].join('/')
          );
          const currentPath = normalizeSharedPath(meta.path);
          if (!newPath || newPath === currentPath) return true;
          const duplicate = sharedFiles.some(
            (file) =>
              file.id !== meta.fileId &&
              normalizeSharedPath(file.path) === newPath
          );
          if (duplicate) {
            showError('A file already exists at that destination.');
            return true;
          }
          (async () => {
            try {
              await adminFetch(
                `/api/admin/shared-packages/${sharedProject.id}/files/${meta.fileId}`,
                {
                  method: 'PUT',
                  body: {
                    path: newPath,
                    fileExtension: resolveSharedExtension(newPath, meta.fileExtension),
                  },
                }
              );
              const nextFiles = sharedFiles.map((file) =>
                file.id === meta.fileId ? { ...file, path: newPath } : file
              );
              const entryPath = normalizeSharedPath(sharedProject.entryPath || '');
              const nextProject =
                currentPath === entryPath
                  ? { ...sharedProject, entryPath: newPath }
                  : sharedProject;
              const updatedProject = await syncSharedPackage(nextProject, nextFiles);
              setSharedProject(updatedProject);
              setSharedFiles(nextFiles);
              sharedFilesRef.current = nextFiles;
              await reloadTree();
            } catch (err) {
              const message = (err as Error).message || 'Failed to move file';
              showError(message);
            }
          })();
          return true;
        }

        if (node.id === 'root') return true;
        const oldPath = getSharedPathFromNodes([...parentPath, node]);
        const newPath = [...targetSegments, node.name];
        if (oldPath.join('/') === newPath.join('/')) return true;

        (async () => {
          try {
            const updates = sharedFiles.filter((file) =>
              pathStartsWith(splitSharedPath(file.path), oldPath)
            );
            await Promise.all(
              updates.map((file) => {
                const segments = splitSharedPath(file.path);
                const remainder = segments.slice(oldPath.length);
                const nextPath = normalizeSharedPath(
                  [...newPath, ...remainder].join('/')
                );
                return adminFetch(
                  `/api/admin/shared-packages/${sharedProject.id}/files/${file.id}`,
                  { method: 'PUT', body: { path: nextPath } }
                );
              })
            );
            const nextFiles = sharedFiles.map((file) => {
              if (!pathStartsWith(splitSharedPath(file.path), oldPath)) return file;
              const segments = splitSharedPath(file.path);
              const remainder = segments.slice(oldPath.length);
              return {
                ...file,
                path: normalizeSharedPath([...newPath, ...remainder].join('/')),
              };
            });
            const nextOverrides = sharedFolderOverrides.map((path) => {
              if (!pathStartsWith(path, oldPath)) return path;
              const remainder = path.slice(oldPath.length);
              return [...newPath, ...remainder];
            });
            setSharedFolderOverrides(nextOverrides);
            const entrySegments = splitSharedPath(sharedProject.entryPath || '');
            const nextProject = pathStartsWith(entrySegments, oldPath)
              ? {
                  ...sharedProject,
                  entryPath: normalizeSharedPath(
                    [...newPath, ...entrySegments.slice(oldPath.length)].join('/')
                  ),
                }
              : sharedProject;
            const updatedProject = await syncSharedPackage(nextProject, nextFiles);
            setSharedProject(updatedProject);
            setSharedFiles(nextFiles);
            sharedFilesRef.current = nextFiles;
            await reloadTree();
          } catch (err) {
            const message = (err as Error).message || 'Failed to move folder';
            showError(message);
          }
        })();
        return true;
      }
      if (!treeData) return true;
      const nodeScopeInfo = getScopeInfo([...parentPath, node]);
      if (!nodeScopeInfo.scope) return true;
      const targetPath = findPathById(treeData, targetId);
      if (!targetPath.length) return true;
      const targetParentPath =
        position === 'inside' ? targetPath : targetPath.slice(0, -1);
      const targetScopeInfo = getScopeInfo(targetParentPath);
      if (!targetScopeInfo.scope || targetScopeInfo.scope !== nodeScopeInfo.scope) {
        const message = 'Cannot move between Modules and UI Entities.';
        showError(message);
        return true;
      }

      if (node.type === 'file') {
        const meta = node.meta as NodeMeta | undefined;
        if (!meta) return true;
        if (meta.kind === 'module') {
          const nextRoute = buildRoutePath(targetScopeInfo.path);
          if (nextRoute === meta.routePath) return true;
          apiFetch(`/api/modules/${meta.backendId}`, {
            method: 'PUT',
            body: {
              routePath: nextRoute,
              method: meta.method,
              fileExtension: MODULE_EXTENSION,
            },
          })
            .then(() => loadTree())
            .catch((err) => {
              const message = (err as Error).message || 'Failed to move module';
              showError(message);
          });
          return true;
        }
        if (meta.kind !== 'ui') return true;
        const nameSegments = splitUiName(meta.name || 'ui');
        const baseName = nameSegments[nameSegments.length - 1] || 'ui';
        const nextName = buildUiName([...targetScopeInfo.path, baseName]);
        if (nextName === meta.name) return true;
        apiFetch(`/api/ui-entities/${meta.backendId}`, {
          method: 'PUT',
          body: {
            name: nextName,
            version: meta.version,
            dependencies: meta.dependencies ?? [],
            fileExtension: coerceUiExtension(meta.fileExtension),
          },
        })
          .then(() => loadTree())
          .catch((err) => {
            const message = (err as Error).message || 'Failed to move UI entity';
            showError(message);
          });
        return true;
      }

      if (node.id === 'modules-root' || node.id === 'ui-root') return true;

      const oldPath = nodeScopeInfo.path;
      const newPath = [...targetScopeInfo.path, node.name];
      if (oldPath.join('/') === newPath.join('/')) return true;

      (async () => {
        try {
          if (nodeScopeInfo.scope === 'modules') {
            const updates = modulesData.filter((mod) =>
              pathStartsWith(splitRoutePath(mod.routePath || '/'), oldPath)
            );
            await Promise.all(
              updates.map((mod) => {
                const segments = splitRoutePath(mod.routePath || '/');
                const remainder = segments.slice(oldPath.length);
                const nextRoute = buildRoutePath([...newPath, ...remainder]);
                return apiFetch(`/api/modules/${mod.id}`, {
                  method: 'PUT',
                  body: { routePath: nextRoute, method: mod.method, fileExtension: MODULE_EXTENSION },
                });
              })
            );
          } else {
            const updates = uiData.filter((pkg) =>
              pathStartsWith(splitUiName(pkg.name || ''), oldPath)
            );
            await Promise.all(
              updates.map((pkg) => {
                const segments = splitUiName(pkg.name || '');
                const remainder = segments.slice(oldPath.length);
                const nextName = buildUiName([...newPath, ...remainder]);
                return apiFetch(`/api/ui-entities/${pkg.id}`, {
                  method: 'PUT',
                  body: {
                    name: nextName,
                    version: pkg.version,
                    dependencies: pkg.dependencies ?? [],
                    fileExtension: coerceUiExtension(pkg.fileExtension),
                  },
                });
              })
            );
          }
          const nextOverrides = folderOverrides.map((item) => {
            if (item.scope !== nodeScopeInfo.scope) return item;
            if (!pathStartsWith(item.path, oldPath)) return item;
            const remainder = item.path.slice(oldPath.length);
            return { scope: nodeScopeInfo.scope, path: [...newPath, ...remainder] };
          });
          setFolderOverrides(nextOverrides);
          await loadTree(nextOverrides);
        } catch (err) {
          const message = (err as Error).message || 'Failed to move folder';
          showError(message);
        }
      })();

      return true;
    },
    [
      adminFetch,
      apiFetch,
      folderOverrides,
      isSharedMode,
      loadTree,
      reloadTree,
      modulesData,
      savedContents,
      sharedFiles,
      sharedFolderOverrides,
      sharedProject,
      showError,
      syncSharedPackage,
      treeData,
      uiData,
    ]
  );

  const nodeContentMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!treeData) return map;
    const walk = (node: ExplorerNode) => {
      if (node.type === 'file') {
        map.set(node.id, node.content ?? '');
      } else {
        node.children?.forEach(walk);
      }
    };
    walk(treeData);
    return map;
  }, [treeData]);

  const searchIncludeFilter = useMemo(
    () => parseFilterRegex(searchIncludePattern),
    [searchIncludePattern]
  );
  const searchExcludeFilter = useMemo(
    () => parseFilterRegex(searchExcludePattern),
    [searchExcludePattern]
  );

  const nodeById = useMemo(() => {
    const map = new Map<string, ExplorerNode>();
    if (!treeData) return map;
    const walk = (node: ExplorerNode) => {
      map.set(node.id, node);
      node.children?.forEach(walk);
    };
    walk(treeData);
    return map;
  }, [treeData]);

  const searchFiles = useMemo(() => {
    if (!treeData) return [];
    const items: Array<{ id: string; name: string; content: string }> = [];
    const walk = (node: ExplorerNode) => {
      if (node.type === 'file') {
        if (searchIncludeFilter.regex && !searchIncludeFilter.regex.test(node.name)) {
          return;
        }
        if (searchExcludeFilter.regex && searchExcludeFilter.regex.test(node.name)) {
          return;
        }
        const content =
          fileContents[node.id] ??
          savedContents[node.id] ??
          node.content ??
          '';
        items.push({ id: node.id, name: node.name, content });
      } else {
        node.children?.forEach(walk);
      }
    };
    walk(treeData);
    return items;
  }, [
    fileContents,
    savedContents,
    searchExcludeFilter.regex,
    searchIncludeFilter.regex,
    treeData,
  ]);

  const getNodeContent = useCallback(
    (id: string) => nodeContentMap.get(id) ?? '',
    [nodeContentMap]
  );

  const getPersistedContent = useCallback(
    (id: string) =>
      savedContents[id] !== undefined ? savedContents[id] : getNodeContent(id),
    [getNodeContent, savedContents]
  );

  const searchResults = useMemo(
    () => buildSearchResults(searchQuery, searchFiles, searchPattern, searchMatchCase),
    [searchMatchCase, searchPattern, searchQuery, searchFiles]
  );

  useEffect(() => {
    if (editorView !== 'preview') return;
    setPreviewNonce((prev) => prev + 1);
  }, [editorView, previewTarget?.name, previewTarget?.version, tenantHost]);

  const previewSrc = useMemo(() => {
    if (!previewTarget || !tenantHost || !previewBaseUrl) {
      return '';
    }
    const name = encodeURIComponent(previewTarget.name);
    const version = encodeURIComponent(previewTarget.version);
    const tenant = encodeURIComponent(
      tenantHost.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    );
    const base = previewBaseUrl.replace(/\/$/, '');
    return `${base}/preview.html?name=${name}&version=${version}&tenantHost=${tenant}&t=${previewNonce}`;
  }, [previewBaseUrl, previewNonce, previewTarget, tenantHost]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchSelected(null);
      setPendingSearchSelection(null);
      clearSearchDecorations();
    }
  }, [clearSearchDecorations, searchQuery]);

  useEffect(() => {
    setSearchSelected(null);
    setPendingSearchSelection(null);
    clearSearchDecorations();
  }, [clearSearchDecorations, searchMatchCase, searchUseRegex, searchWholeWord]);

  useEffect(() => {
    if (!pendingSearchSelection) return;
    if (!activeFile || activeFile.id !== pendingSearchSelection.fileId) return;
    const editor = mainEditorRef.current;
    if (!editor) return;
    const range = pendingSearchSelection.range;
    editor.setSelection(range);
    editor.revealRangeInCenter(range);
    applySearchDecorations(range);
    setPendingSearchSelection(null);
  }, [activeFile?.id, applySearchDecorations, pendingSearchSelection]);

  useEffect(() => {
    if (!searchQuery.trim() || !searchSelected || searchSelected.fileId !== activeFile?.id) {
      clearSearchDecorations();
    }
  }, [activeFile?.id, clearSearchDecorations, searchQuery, searchSelected]);

  useEffect(() => {
    if (!searchSelected || searchSelected.fileId !== activeFile?.id) return;
    applySearchDecorations(searchSelected.range);
  }, [activeFile?.id, applySearchDecorations, searchSelected]);

  const openSearchResult = useCallback(
    (result: SearchResult) => {
      const node = nodeById.get(result.fileId);
      if (!node) return;
      if (rightPaneSet.has(result.fileId)) {
        moveTabToPane(result.fileId, 'left');
      }
      handleOpenFile(node);
      setSearchSelected(result);
      setPendingSearchSelection(result);
    },
    [handleOpenFile, moveTabToPane, nodeById, rightPaneSet]
  );

  const replaceSelectedResult = useCallback(() => {
    if (!searchSelected) return;
    const fileId = searchSelected.fileId;
    const content = fileContents[fileId] ?? getPersistedContent(fileId);
    const updated = replaceAtRange(content, searchSelected.range, searchReplace);
    if (updated === content) return;
    setFileContents((prev) => ({ ...prev, [fileId]: updated }));
    setSearchSelected(null);
    setPendingSearchSelection(null);
  }, [fileContents, getPersistedContent, searchReplace, searchSelected]);

  const replaceAllResults = useCallback(() => {
    if (!searchQuery.trim() || searchPattern.error) return;
    const regex = searchPattern.isRegex
      ? new RegExp(
          searchPattern.source,
          searchMatchCase ? 'g' : 'gi'
        )
      : new RegExp(escapeRegExp(searchQuery), searchMatchCase ? 'g' : 'gi');
    const updates: Record<string, string> = {};
    searchFiles.forEach((file) => {
      const content = fileContents[file.id] ?? getPersistedContent(file.id);
      const nextContent = content.replace(regex, searchReplace);
      if (nextContent !== content) {
        updates[file.id] = nextContent;
      }
    });
    if (Object.keys(updates).length === 0) return;
    setFileContents((prev) => ({ ...prev, ...updates }));
    setSearchSelected(null);
    setPendingSearchSelection(null);
  }, [
    fileContents,
    getPersistedContent,
    searchMatchCase,
    searchFiles,
    searchPattern.error,
    searchPattern.isRegex,
    searchPattern.source,
    searchQuery,
    searchReplace,
  ]);

  const activeContent = activeFile
    ? fileContents[activeFile.id] ?? getPersistedContent(activeFile.id)
    : '';
  const selectedRevision = useMemo(
    () => historyItems.find((item) => item.id === historySelectedId) ?? null,
    [historyItems, historySelectedId]
  );
  const editorModelPath = useMemo(() => {
    if (!activeFile) return undefined;
    return `inmemory://model/${activeFile.id}`;
  }, [activeFile]);
  const diffModelPaths = useMemo(() => {
    if (!activeFile || !selectedRevision) {
      return {
        original: 'inmemory://model/diff/original',
        modified: 'inmemory://model/diff/modified',
      };
    }
    return {
      original: `inmemory://model/${activeFile.id}/revision/${selectedRevision.id}`,
      modified: `inmemory://model/${activeFile.id}/current`,
    };
  }, [activeFile, selectedRevision]);

  const monacoLanguage = useMemo(() => {
    if (!activeFile) return 'plaintext';
    return activeFile.language === 'jsx' ? 'javascript' : activeFile.language;
  }, [activeFile]);

  const sideLanguage = useMemo(() => {
    if (!sideFile) return 'plaintext';
    return sideFile.language === 'jsx' ? 'javascript' : sideFile.language;
  }, [sideFile]);

  const sideEditorModelPath = useMemo(() => {
    if (!sideFile) return undefined;
    return `inmemory://model/${sideFile.id}/side`;
  }, [sideFile]);

  const sideContent = sideFile
    ? fileContents[sideFile.id] ?? getPersistedContent(sideFile.id)
    : '';
  const showSplitEditor = rightTabs.length > 0;
  const showDiff = Boolean(selectedRevision);
  const diffOriginal = selectedRevision ? getRevisionContent(selectedRevision) : '';
  const mainEditorPath = activeFile ? editorModelPath : 'inmemory://model/empty-main';
  const mainEditorValue = activeFile ? activeContent : '';
  const mainEditorLanguage = activeFile ? monacoLanguage : 'plaintext';
  const sideEditorPath = sideFile ? sideEditorModelPath : 'inmemory://model/side-empty';
  const sideEditorValue = sideFile ? sideContent : '';
  const sideEditorLanguage = sideFile ? sideLanguage : 'plaintext';

  useEffect(() => {
    const seedIfMissing = (fileId: string | null) => {
      if (!fileId) return;
      const persistedContent = getPersistedContent(fileId);
      setFileContents((prev) => {
        const current = prev[fileId];
        if (current === undefined) {
          return { ...prev, [fileId]: persistedContent };
        }
        if (current === '' && savedContents[fileId] === undefined && persistedContent) {
          return { ...prev, [fileId]: persistedContent };
        }
        return prev;
      });
    };
    seedIfMissing(activeFile?.id ?? null);
    seedIfMissing(sideFile?.id ?? null);
  }, [activeFile?.id, getPersistedContent, savedContents, sideFile?.id]);

  const activeFileType = useMemo(() => {
    if (!activeFile) return '';
    const metaExt =
      activeFile.meta?.fileExtension &&
      typeof activeFile.meta.fileExtension === 'string'
        ? activeFile.meta.fileExtension
        : '';
    const nameExt = extractFileExtension(activeFile.name);
    return (metaExt || nameExt || 'text').toUpperCase();
  }, [activeFile]);

  const handleRollback = async (revisionId: string) => {
    if (!activeFile?.meta) return;
    try {
      if (activeFile.meta.kind === 'module') {
        const updated = (await apiFetch(
          `/api/modules/${activeFile.meta.backendId}/rollback/${revisionId}`,
          { method: 'POST' }
        )) as ModuleDto;
        const rolledContent = updated.code ?? '';
        setFileContents((prev) => ({
          ...prev,
          [activeFile.id]: rolledContent,
        }));
        setSavedContents((prev) => ({ ...prev, [activeFile.id]: rolledContent }));
      } else if (activeFile.meta.kind === 'ui') {
        const updated = (await apiFetch(
          `/api/ui-entities/${activeFile.meta.backendId}/rollback/${revisionId}`,
          { method: 'POST' }
        )) as UIPackageDto;
        const rolledContent = updated.code ?? updated.codeBlob ?? '';
        setFileContents((prev) => ({
          ...prev,
          [activeFile.id]: rolledContent,
        }));
        setSavedContents((prev) => ({ ...prev, [activeFile.id]: rolledContent }));
      } else {
        showError('Rollback is not available for shared projects yet.');
        return;
      }
      success('Rolled back');
      await reloadTree();
      loadHistory();
    } catch (err) {
      const message = (err as Error).message || 'Rollback failed';
      showError(message);
    }
  };

  const handleSwitchToPreview = useCallback(() => {
    if (isSharedMode && sharedProject) {
      setPreviewTarget({
        kind: 'shared',
        name: sharedProject.name,
        version: sharedProject.version,
      });
    } else if (!isSharedMode && !previewTarget && uiData.length > 0) {
      const first = uiData[0];
      if (first?.name && first?.version) {
        setPreviewTarget({ kind: 'ui', name: first.name, version: first.version });
      }
    }
    setEditorView('preview');
  }, [isSharedMode, previewTarget, sharedProject, uiData]);

  const renderTabContextMenu = () => {
    if (!tabMenu) return null;
    const file = openFiles.find((item) => item.id === tabMenu.fileId);
    if (!file) return null;
    const index = openFiles.findIndex((item) => item.id === file.id);
    const leftIds = new Set(openFiles.slice(0, index).map((item) => item.id));
    const rightIds = new Set(openFiles.slice(index + 1).map((item) => item.id));
    const dirtyIds = new Set(
      openFiles.filter((item) => isFileDirty(item)).map((item) => item.id)
    );
    const savedIds = new Set(
      openFiles.filter((item) => !isFileDirty(item)).map((item) => item.id)
    );
    const allIds = new Set(openFiles.map((item) => item.id));
    const itemClass =
      'flex w-full items-center px-3 py-2 text-left text-sm hover:bg-[#2e2e2e]';
    const disabledClass = 'opacity-50 cursor-not-allowed hover:bg-transparent';

    return (
      <div
        className="fixed z-50 min-w-[220px] rounded border border-[#2a2d2e] bg-[#252526] text-gray-200 shadow-lg"
        style={{ top: tabMenu.y, left: tabMenu.x }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className={itemClass}
          onClick={() => {
            requestCloseTabs(new Set([file.id]));
            setTabMenu(null);
          }}
        >
          Close
        </button>
        <button
          className={`${itemClass} ${allIds.size === 0 ? disabledClass : ''}`}
          onClick={() => {
            requestCloseTabs(allIds);
            setTabMenu(null);
          }}
          disabled={allIds.size === 0}
        >
          Close All
        </button>
        <button
          className={`${itemClass} ${rightIds.size === 0 ? disabledClass : ''}`}
          onClick={() => {
            requestCloseTabs(rightIds);
            setTabMenu(null);
          }}
          disabled={rightIds.size === 0}
        >
          Close to the Right
        </button>
        <button
          className={`${itemClass} ${leftIds.size === 0 ? disabledClass : ''}`}
          onClick={() => {
            requestCloseTabs(leftIds);
            setTabMenu(null);
          }}
          disabled={leftIds.size === 0}
        >
          Close to the Left
        </button>
        <button
          className={`${itemClass} ${savedIds.size === 0 ? disabledClass : ''}`}
          onClick={() => {
            requestCloseTabs(savedIds);
            setTabMenu(null);
          }}
          disabled={savedIds.size === 0}
        >
          Close Saved
        </button>
        <div className="border-t border-[#2a2d2e]" />
        <button
          className={itemClass}
          onClick={() => {
            void handleSaveFile(file);
            setTabMenu(null);
          }}
        >
          Save
        </button>
        <button
          className={itemClass}
          onClick={() => {
            void handleSaveAll();
            setTabMenu(null);
          }}
        >
          Save All
        </button>
        <div className="border-t border-[#2a2d2e]" />
        <button
          className={itemClass}
          onClick={() => {
            setHistorySelectedId(null);
            if (rightPaneSet.has(file.id)) {
              moveTabToPane(file.id, 'left');
            } else {
              moveTabToPane(file.id, 'right');
            }
            setTabMenu(null);
          }}
        >
          {rightPaneSet.has(file.id) ? 'Close Side' : 'Open in Side'}
        </button>
      </div>
    );
  };

  return (
    <>
      <Script src="/babel/bable.js" strategy="afterInteractive" />
      <div className="flex h-screen flex-col bg-[#1e1e1e] text-gray-100">
        <header className="relative flex h-[34px] items-center border-b border-[#2a2d2e] bg-[#252526] px-2">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#2a2d2e] bg-[#1e1e1e]">
                <Image
                  src={branding.logo_lm}
                  alt={branding.brand_name}
                  width={18}
                  height={18}
                />
              </span>
              <div className="leading-tight">
                <div className="text-[8px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                  {branding.brand_name} Idp
                </div>
                <div className="text-[12px] font-semibold text-gray-100">Editor Studio</div>
              </div>
            </Link>

            <nav className="hidden lg:flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
              {EDITOR_NAV_ITEMS.map((item) => {
                const isActive =
                  router.pathname === item.match ||
                  router.pathname.startsWith(`${item.match}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-full border px-3 py-1 transition ${
                      isActive
                        ? 'border-[#0f72be] bg-[#0b5b96] text-white'
                        : 'border-transparent text-gray-400 hover:border-[#2a2d2e] hover:bg-[#1f1f1f] hover:text-gray-200'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="ml-auto flex items-center gap-2 text-[11px]">
            <div className="flex items-center gap-3 rounded-full border border-[#2a2d2e] bg-[#1f1f1f] p-0.5 text-[10px] uppercase tracking-wide text-gray-300">
              <button
                type="button"
                onClick={() => setEditorView('code')}
                className={`rounded-full px-3 py-0.5 transition ${
                  editorView === 'code'
                    ? 'bg-[#0b5b96] text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Code
              </button>
              <button
                type="button"
                onClick={handleSwitchToPreview}
                className={`rounded-full px-3 py-0.5 transition ${
                  editorView === 'preview'
                    ? 'bg-[#0b5b96] text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Preview
              </button>
              {editorView === 'preview' && (
                <div className="flex items-center gap-2 border-l border-[#2a2d2e] pl-2 text-[10px] text-gray-400">
                  <span className="uppercase tracking-[0.2em]">Port</span>
                  <input
                    value={previewPort}
                    onChange={(event) =>
                      setPreviewPort(event.target.value.replace(/[^0-9]/g, ''))
                    }
                    placeholder={DEFAULT_PREVIEW_PORT}
                    className="h-5 w-16 rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 text-[10px] text-gray-200 placeholder:text-gray-500 focus:border-[#0b5b96] focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex flex-1 min-h-0">
          <div className="flex h-full w-12 flex-col items-center border-r border-[#2a2d2e] bg-[#1b1b1b] py-2">
            <button
              title="Explorer"
              className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg text-base transition ${
                leftPanel === 'explorer'
                  ? 'bg-[#094771] text-white'
                  : 'text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200'
              }`}
              onClick={() => {
                setLeftPanel('explorer');
                setLeftPanelOpen(true);
              }}
              onDoubleClick={() => {
                if (leftPanelOpen && leftPanel === 'explorer') {
                  setLeftPanelOpen(false);
                } else {
                  setLeftPanel('explorer');
                  setLeftPanelOpen(true);
                }
              }}
            >
              <FiFolder />
            </button>
            <button
              title="Search"
              className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg text-base transition ${
                leftPanel === 'search'
                  ? 'bg-[#094771] text-white'
                  : 'text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200'
              }`}
              onClick={() => {
                setLeftPanel('search');
                setLeftPanelOpen(true);
              }}
              onDoubleClick={() => {
                if (leftPanelOpen && leftPanel === 'search') {
                  setLeftPanelOpen(false);
                } else {
                  setLeftPanel('search');
                  setLeftPanelOpen(true);
                }
              }}
            >
              <FiSearch />
            </button>
            <button
              title="History"
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-base transition ${
                leftPanel === 'history'
                  ? 'bg-[#094771] text-white'
                  : 'text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200'
              }`}
              onClick={() => {
                setLeftPanel('history');
                setLeftPanelOpen(true);
              }}
              onDoubleClick={() => {
                if (leftPanelOpen && leftPanel === 'history') {
                  setLeftPanelOpen(false);
                } else {
                  setLeftPanel('history');
                  setLeftPanelOpen(true);
                }
              }}
            >
              <FiClock />
            </button>
            <button
              title="Staging"
              className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg text-base transition ${
                leftPanel === 'staging'
                  ? 'bg-[#094771] text-white'
                  : 'text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200'
              }`}
              onClick={() => {
                setLeftPanel('staging');
                setLeftPanelOpen(true);
              }}
              onDoubleClick={() => {
                if (leftPanelOpen && leftPanel === 'staging') {
                  setLeftPanelOpen(false);
                } else {
                  setLeftPanel('staging');
                  setLeftPanelOpen(true);
                }
              }}
            >
              <FiFlag />
            </button>
            <div className="mt-auto flex w-full flex-col items-center px-1 pb-2">
              <div
                className={`flex w-full flex-col items-center gap-2 px-1 py-2 text-[10px] ${sidebarLabelTone}`}
                title={sidebarLabel}
              >
                <span
                  className="font-semibold"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                >
                  {sidebarLabel}
                </span>
              </div>
            </div>
          </div>

          {leftPanelOpen && (
            <div
              className="relative flex h-full min-w-0 flex-col overflow-hidden border-r border-[#2a2d2e] bg-[#252526] text-gray-100"
              style={{ width: leftPanelWidth }}
            >
              {leftPanel === 'explorer' ? (
                treeError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-sm text-red-300">
                    <p>{treeError}</p>
                    <button
                      className="rounded bg-[#094771] px-3 py-1 text-white hover:bg-[#0b5b96]"
                      onClick={() => reloadTree()}
                    >
                      Retry
                    </button>
                  </div>
                ) : !treeData || loadingTree ? (
                  <div className="flex h-full items-center justify-center text-sm text-gray-400">
                    Loading explorer...
                  </div>
                ) : (
                  <FileExplorer
                    key={treeData.id}
                    onOpenFile={handleOpenFile}
                    initialTree={treeData}
                    onCreateNode={({ type, parentPath }) =>
                      handleCreateRequest({ type, parentPath })
                    }
                    onRenameNode={({ node, parentPath }) =>
                      handleRenameRequest({ node, parentPath })
                    }
                    onDeleteNode={({ node, parentPath }) =>
                      handleDeleteRequest({ node, parentPath })
                    }
                    onMoveNode={({ node, targetId, position, parentPath }) =>
                      handleMoveRequest({ node, targetId, position, parentPath })
                    }
                  />
                )
              ) : leftPanel === 'history' ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
                    <div>History</div>
                    <button
                      className="rounded p-1 text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200 disabled:opacity-60"
                      onClick={() => loadHistory(historyPage)}
                      disabled={
                        historyLoading ||
                        !activeFile?.meta ||
                        activeFile.meta.kind === 'shared'
                      }
                      aria-label="Refresh history"
                      title="Refresh history"
                      type="button"
                    >
                      <FiRefreshCw className="h-4 w-4" />
                    </button>
                  </div>

                  {!activeFile?.meta ? (
                    <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
                      Select a file to view history.
                    </div>
                  ) : activeFile.meta.kind === 'shared' ? (
                    <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
                      History is not available for shared projects yet.
                    </div>
                  ) : historyLoading ? (
                    <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
                      Loading history...
                    </div>
                  ) : historyError ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-sm text-red-300">
                      <p>{historyError}</p>
                      <button
                        className="rounded bg-[#094771] px-3 py-1 text-white hover:bg-[#0b5b96]"
                        onClick={() => loadHistory(historyPage)}
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div
                        ref={historyListRef}
                        className="flex min-h-0 flex-1 flex-col overflow-hidden"
                      >
                        {historyItems.length === 0 ? (
                          <div className="flex h-full items-center justify-center px-4 text-sm text-gray-400">
                            No revisions yet.
                          </div>
                        ) : (
                          historyItems.map((item, index) => {
                            const selected = item.id === historySelectedId;
                            return (
                              <div
                                key={item.id}
                                ref={index === 0 ? historyRowRef : undefined}
                                className={`border-b border-[#2a2d2e] px-2 py-1.5 text-[11px] ${
                                  selected ? 'bg-[#1f1f1f]' : 'bg-transparent'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-2 text-[10px] font-semibold text-gray-100">
                                      <span>r{item.revision}</span>
                                      <span className="text-[9px] uppercase tracking-wide text-gray-500">
                                        {(item.action ?? 'update').toUpperCase()}
                                      </span>
                                    </div>
                                    <div className="mt-0.5 text-[9px] text-gray-500">
                                      {formatHistoryTimestamp(item.createdAt)}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      className="rounded p-1 text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200"
                                      onClick={() =>
                                        setHistorySelectedId((prev) =>
                                          prev === item.id ? null : item.id
                                        )
                                      }
                                      aria-label={selected ? 'Close compare' : 'Compare revision'}
                                      title={selected ? 'Close compare' : 'Compare revision'}
                                    >
                                      {selected ? (
                                        <FiEyeOff className="h-4 w-4" />
                                      ) : (
                                        <FiEye className="h-4 w-4" />
                                      )}
                                    </button>
                                    <button
                                      className="rounded p-1 text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200"
                                      onClick={() => handleRollback(item.id)}
                                      aria-label="Rollback revision"
                                      title="Rollback revision"
                                    >
                                      <FiRotateCcw className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                      <div className="flex h-7 items-center justify-between border-t border-[#2a2d2e] px-2 text-[10px] text-gray-400">
                        <button
                          className="rounded p-1 text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200 disabled:opacity-50"
                          onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                          disabled={historyLoading || historyPage <= 1}
                          aria-label="Previous page"
                          title="Previous page"
                        >
                          <FiChevronLeft className="h-4 w-4" />
                        </button>
                        <div>
                          Page {historyPage} / {historyTotalPages}
                        </div>
                        <button
                          className="rounded p-1 text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200 disabled:opacity-50"
                          onClick={() =>
                            setHistoryPage((prev) =>
                              Math.min(historyTotalPages, prev + 1)
                            )
                          }
                          disabled={historyLoading || historyPage >= historyTotalPages}
                          aria-label="Next page"
                          title="Next page"
                        >
                          <FiChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : leftPanel === 'staging' ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
                    <div>Staging</div>
                    <div className="text-[10px] text-gray-500">
                      {stagingCounts.published}/{stagingCounts.total} published
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 overflow-auto p-2 text-[11px] text-gray-300">
                    {stagingItems.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                        No files available for staging.
                      </div>
                    ) : (
                      stagingItems.map((item) => {
                        const isPublished = Boolean(item.publishedVersion);
                        const isDirty = Boolean(item.dirty);
                        const isPublishing = stagingBusy && stagingBusyId === item.id;
                        const kindLabel =
                          item.kind === 'module'
                            ? 'Module'
                            : item.kind === 'ui'
                              ? 'UI'
                              : 'Shared';
                        return (
                          <div
                            key={item.id}
                            className="rounded border border-[#2a2d2e] bg-[#1f1f1f] p-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-[12px] font-semibold text-gray-100">
                                    {item.title}
                                  </span>
                                  <span className="rounded border border-[#2a2d2e] px-1.5 py-0.5 text-[9px] uppercase text-gray-400">
                                    {kindLabel}
                                  </span>
                                </div>
                                <div className="mt-1 text-[10px] text-gray-400">
                                  <span className="mr-2">
                                    Draft: {item.draftVersion || '—'}
                                  </span>
                                  <span>Published: {item.publishedVersion || '—'}</span>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                {isDirty && (
                                  <span className="rounded bg-[#3b1f1f] px-1.5 py-0.5 text-[9px] text-red-200">
                                    Unsaved
                                  </span>
                                )}
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[9px] ${
                                    isPublished
                                      ? 'bg-emerald-900/40 text-emerald-300'
                                      : 'bg-[#2a2d2e] text-gray-400'
                                  }`}
                                >
                                  {isPublished ? 'Published' : 'Draft'}
                                </span>
                                <button
                                  type="button"
                                  className="rounded bg-[#0b5b96] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#0f72be] disabled:opacity-60"
                                  onClick={() => publishTarget(item)}
                                  disabled={stagingBusy || isDirty}
                                >
                                  {isPublishing ? 'Publishing…' : isPublished ? 'Republish' : 'Publish'}
                                </button>
                              </div>
                            </div>
                            <div className="mt-1 text-[9px] text-gray-500">
                              {item.publishedAt
                                ? `Published ${formatHistoryTimestamp(item.publishedAt)}`
                                : 'Not published yet'}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
                    <div>Search</div>
                    <div className="text-[10px] text-gray-500">
                      {searchResults.length} result
                      {searchResults.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="border-b border-[#2a2d2e] p-3">
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search files"
                      className="w-full rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 py-1 text-[12px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0b5b96]"
                    />
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                      <button
                        type="button"
                        className={`rounded border px-2 py-0.5 ${
                          searchMatchCase
                            ? 'border-[#0b5b96] bg-[#0b5b96] text-white'
                            : 'border-[#2a2d2e] text-gray-400 hover:bg-[#1f1f1f]'
                        }`}
                        onClick={() => setSearchMatchCase((prev) => !prev)}
                        title="Match case"
                      >
                        Aa
                      </button>
                      <button
                        type="button"
                        className={`rounded border px-2 py-0.5 ${
                          searchWholeWord
                            ? 'border-[#0b5b96] bg-[#0b5b96] text-white'
                            : 'border-[#2a2d2e] text-gray-400 hover:bg-[#1f1f1f]'
                        }`}
                        onClick={() => setSearchWholeWord((prev) => !prev)}
                        title="Match whole word"
                      >
                        W
                      </button>
                      <button
                        type="button"
                        className={`rounded border px-2 py-0.5 ${
                          searchUseRegex
                            ? 'border-[#0b5b96] bg-[#0b5b96] text-white'
                            : 'border-[#2a2d2e] text-gray-400 hover:bg-[#1f1f1f]'
                        }`}
                        onClick={() => setSearchUseRegex((prev) => !prev)}
                        title="Use regular expression"
                      >
                        .*
                      </button>
                      <span className="ml-auto text-[10px] text-red-300">
                        {searchPattern.error}
                      </span>
                    </div>
                  </div>
                  <div className="border-b border-[#2a2d2e] p-3">
                    <div className="flex items-center gap-2">
                      <input
                        value={searchReplace}
                        onChange={(event) => setSearchReplace(event.target.value)}
                        placeholder="Replace"
                        className="flex-1 rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 py-1 text-[12px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0b5b96]"
                      />
                      <button
                        type="button"
                        className="rounded border border-[#2a2d2e] p-1.5 text-gray-200 hover:bg-[#1f1f1f] disabled:opacity-50"
                        onClick={replaceSelectedResult}
                        disabled={!searchSelected}
                        title="Replace"
                        aria-label="Replace"
                      >
                        <FiCornerDownLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[#2a2d2e] p-1.5 text-gray-200 hover:bg-[#1f1f1f] disabled:opacity-50"
                        onClick={replaceAllResults}
                        disabled={searchResults.length === 0}
                        title="Replace all"
                        aria-label="Replace all"
                      >
                        <FiChevronsRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="border-b border-[#2a2d2e] p-3">
                    <div className="flex flex-col gap-2 text-[10px] text-gray-400">
                      <div className="flex items-center gap-2">
                        <span className="w-16">Include</span>
                        <input
                          value={searchIncludePattern}
                          onChange={(event) => setSearchIncludePattern(event.target.value)}
                          placeholder="e.g. \\.tsx$"
                          className="flex-1 rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 py-1 text-[11px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0b5b96]"
                        />
                        <span className="text-[10px] text-red-300">
                          {searchIncludeFilter.error}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16">Exclude</span>
                        <input
                          value={searchExcludePattern}
                          onChange={(event) => setSearchExcludePattern(event.target.value)}
                          placeholder="e.g. \\.spec\\."
                          className="flex-1 rounded border border-[#2a2d2e] bg-[#1b1b1b] px-2 py-1 text-[11px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0b5b96]"
                        />
                        <span className="text-[10px] text-red-300">
                          {searchExcludeFilter.error}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-500">
                        Regex filters match against file names.
                      </span>
                    </div>
                  </div>
                  {searchQuery.trim().length === 0 ? (
                    <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
                      Type to search across files.
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
                      No matches found.
                    </div>
                  ) : (
                    <div className="flex-1 overflow-auto">
                      <div className="space-y-1 p-2">
                        {searchResults.map((result) => {
                          const isActive = searchSelected?.id === result.id;
                          return (
                            <button
                              key={result.id}
                              type="button"
                              onClick={() => openSearchResult(result)}
                              className={`flex w-full flex-col gap-1 rounded border px-2 py-1.5 text-left text-[11px] transition ${
                                isActive
                                  ? 'border-[#0b5b96] bg-[#1f2f3a] text-white'
                                  : 'border-transparent text-gray-300 hover:border-[#2a2d2e] hover:bg-[#1f1f1f]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-[11px] text-gray-200">
                                  {result.fileName}
                                </span>
                                <span className="text-[10px] text-gray-500">
                                  {result.line}:{result.column}
                                </span>
                              </div>
                              <div className="truncate text-[10px] text-gray-400">
                                {result.preview}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div
                className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-[#2a2d2e]"
                onMouseDown={handleResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize left panel"
              />
            </div>
          )}

          <main className="flex flex-1 flex-col min-w-0 min-h-0">
            <div
              className={`relative flex h-[34px] items-stretch border-b border-[#2a2d2e] bg-[#252526] ${
                editorView === 'preview' ? 'hidden' : ''
              }`}
            >
              <div className="flex min-w-0 flex-1 items-stretch">
                <div
                  className="flex min-w-0 items-end overflow-x-auto overflow-y-hidden"
                  style={
                    showSplitEditor
                      ? {
                          flexBasis: `${splitRatio * 100}%`,
                          flexGrow: 0,
                          flexShrink: 0,
                        }
                      : { flexGrow: 1 }
                  }
                  onDragOver={handleTabDragOver}
                  onDrop={(event) => handleTabBarDrop(event, 'left')}
                >
                  <div className="flex min-w-max items-end gap-1 px-2">
                    {leftTabs.map((file) => {
                      const isActive = activeFile?.id === file.id;
                      return (
                        <div
                          key={file.id}
                          role="tab"
                          aria-selected={isActive}
                          tabIndex={0}
                          draggable
                          onDragStart={(event) => handleTabDragStart(event, file.id)}
                          onDragOver={handleTabDragOver}
                          onDrop={(event) => handleTabDrop(event, file.id, 'left')}
                          onDragEnd={handleTabDragEnd}
                          onClick={() => setActiveFile(file)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setActiveFile(file);
                            }
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setActiveFile(file);
                            setTabMenu({
                              x: event.clientX,
                              y: event.clientY,
                              fileId: file.id,
                            });
                          }}
                          className={`group relative flex h-[30px] cursor-grab select-none items-center gap-1.5 rounded-t-md border pl-2 pr-[0.225rem] py-0.5 text-[11px] active:cursor-grabbing ${
                            isActive
                              ? 'border-[#2a2d2e] border-b-[#1e1e1e] bg-[#1e1e1e] text-white shadow-[inset_0_1px_0_#2f2f2f]'
                              : 'border-transparent text-gray-300 hover:bg-[#2a2d2e] hover:text-white'
                          }`}
                          title={file.name}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {isFileDirty(file) && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[#d7ba7d]" />
                            )}
                            <span className="max-w-[180px] truncate">{file.name}</span>
                          </span>
                          <button
                            type="button"
                            aria-label={`Close ${file.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleCloseFile(file.id);
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onDragStart={(event) => event.stopPropagation()}
                            className={`flex h-5 w-5 items-center justify-center rounded text-[12px] transition ${
                              isActive
                                ? 'text-gray-300 hover:bg-[#3a3d41] hover:text-white'
                                : 'text-gray-400 hover:bg-[#3a3d41] hover:text-white'
                            } ${
                              isFileDirty(file)
                                ? 'opacity-0 group-hover:opacity-100'
                                : isActive
                                  ? 'opacity-100'
                                  : 'opacity-0 group-hover:opacity-100'
                            }`}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {rightTabs.length > 0 && (
                  <>
                    <div
                      className="w-1.5 cursor-col-resize bg-[#2a2d2e] opacity-60 hover:opacity-100"
                      onMouseDown={handleSplitResizeStart}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize editor split"
                    />
                    <div
                      className="flex min-w-0 items-end overflow-x-auto overflow-y-hidden"
                      style={{
                        flexBasis: `${(1 - splitRatio) * 100}%`,
                        flexGrow: 0,
                        flexShrink: 0,
                      }}
                      onDragOver={handleTabDragOver}
                      onDrop={(event) => handleTabBarDrop(event, 'right')}
                    >
                      <div className="flex min-w-max items-end gap-1 px-2">
                        {rightTabs.map((file) => {
                          const isActive = sideFile?.id === file.id;
                          return (
                            <div
                              key={file.id}
                              role="tab"
                              aria-selected={isActive}
                              tabIndex={0}
                              draggable
                              onDragStart={(event) => handleTabDragStart(event, file.id)}
                              onDragOver={handleTabDragOver}
                              onDrop={(event) => handleTabDrop(event, file.id, 'right')}
                              onDragEnd={handleTabDragEnd}
                              onClick={() => setSideFileId(file.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setSideFileId(file.id);
                                }
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setSideFileId(file.id);
                                setTabMenu({
                                  x: event.clientX,
                                  y: event.clientY,
                                  fileId: file.id,
                                });
                              }}
                              className={`group relative flex h-[30px] cursor-grab select-none items-center gap-1.5 rounded-t-md border pl-2 pr-[0.225rem] py-0.5 text-[11px] active:cursor-grabbing ${
                                isActive
                                  ? 'border-[#2a2d2e] border-b-[#1e1e1e] bg-[#1e1e1e] text-white shadow-[inset_0_1px_0_#2f2f2f]'
                                  : 'border-transparent text-gray-300 hover:bg-[#2a2d2e] hover:text-white'
                              }`}
                              title={file.name}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                {isFileDirty(file) && (
                                  <span className="h-1.5 w-1.5 rounded-full bg-[#d7ba7d]" />
                                )}
                                <span className="max-w-[180px] truncate">{file.name}</span>
                              </span>
                              <button
                                type="button"
                                aria-label={`Close ${file.name}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCloseFile(file.id);
                                }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onDragStart={(event) => event.stopPropagation()}
                                className={`flex h-5 w-5 items-center justify-center rounded text-[12px] transition ${
                                  isActive
                                    ? 'text-gray-300 hover:bg-[#3a3d41] hover:text-white'
                                    : 'text-gray-400 hover:bg-[#3a3d41] hover:text-white'
                                } ${
                                  isFileDirty(file)
                                    ? 'opacity-0 group-hover:opacity-100'
                                    : isActive
                                      ? 'opacity-100'
                                      : 'opacity-0 group-hover:opacity-100'
                                }`}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 px-2 text-[11px] text-gray-300">
                {selectedRevision && (
                  <button
                    className="rounded border border-[#3c3c3c] px-3 py-1 text-gray-200 hover:bg-[#2a2d2e]"
                    onClick={() => setHistorySelectedId(null)}
                  >
                    Exit compare
                  </button>
                )}
              </div>
            </div>

          <div
            ref={editorAreaRef}
            className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden bg-[#1e1e1e]"
            onDragOverCapture={handleTabDragOver}
            onDropCapture={handleEditorDrop}
            onDragOver={handleTabDragOver}
            onDrop={handleEditorDrop}
          >
            <div
              className={`flex flex-1 min-h-0 min-w-0 ${
                editorView === 'preview' ? 'hidden' : ''
              }`}
            >
              <div className={`flex min-h-0 min-w-0 flex-1 ${showDiff ? 'hidden' : ''}`}>
                <div
                  className="flex min-w-0 flex-col"
                  style={
                    showSplitEditor
                      ? {
                          flexBasis: `${splitRatio * 100}%`,
                          flexGrow: 0,
                          flexShrink: 0,
                        }
                      : { flexGrow: 1, flexShrink: 1 }
                  }
                >
                  <div className="flex-1 min-h-0">
                    <MonacoEditor
                      height="100%"
                      language={mainEditorLanguage}
                      theme="vs-dark"
                      value={mainEditorValue}
                      path={mainEditorPath}
                      keepCurrentModel
                      onMount={(editor) => {
                        mainEditorRef.current = editor;
                      }}
                      onChange={handleEditorChange}
                      options={{
                        fontSize: 14,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        readOnly: !activeFile,
                      }}
                    />
                  </div>
                </div>
                {showSplitEditor && (
                  <div
                    className="flex w-1.5 cursor-col-resize items-stretch bg-[#2a2d2e] opacity-60 hover:opacity-100"
                    onMouseDown={handleSplitResizeStart}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize editor split"
                  />
                )}
                <div
                  className={`flex min-w-0 flex-col overflow-hidden ${
                    showSplitEditor ? '' : 'hidden'
                  }`}
                  style={
                    showSplitEditor
                      ? {
                          flexBasis: `${(1 - splitRatio) * 100}%`,
                          flexGrow: 0,
                          flexShrink: 0,
                          borderLeft: '1px solid #2a2d2e',
                        }
                      : undefined
                  }
                >
                  <div className="flex-1 min-h-0">
                      <MonacoEditor
                        height="100%"
                        language={sideEditorLanguage}
                        theme="vs-dark"
                        value={sideEditorValue}
                        path={sideEditorPath}
                        keepCurrentModel
                        onMount={(editor) => {
                          sideEditorRef.current = editor;
                        }}
                        onChange={handleSideEditorChange}
                      options={{
                        fontSize: 14,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        readOnly: !sideFile,
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className={`flex min-h-0 flex-1 ${showDiff ? '' : 'hidden'}`}>
                <MonacoDiffEditor
                  height="100%"
                  language={mainEditorLanguage}
                  theme="vs-dark"
                  original={diffOriginal}
                  modified={mainEditorValue}
                  originalModelPath={diffModelPaths.original}
                  modifiedModelPath={diffModelPaths.modified}
                  keepCurrentOriginalModel
                  keepCurrentModifiedModel
                  options={{
                    fontSize: 14,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    readOnly: true,
                    renderSideBySide: true,
                  }}
                />
              </div>
            </div>
            <div
              className={`flex min-h-0 flex-1 ${
                editorView === 'preview' ? '' : 'hidden'
              }`}
            >
              {!previewTarget ? (
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                  {isSharedMode
                    ? 'Switch to preview to load the shared project.'
                    : uiData.length === 0
                      ? 'No UI entities available for preview.'
                      : 'Preview is loading...'}
                </div>
              ) : !tenantHost ? (
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                  Select a tenant to load preview.
                </div>
              ) : (
                <iframe
                  key={previewSrc}
                  title="UI preview"
                  className="h-full w-full border-0 bg-white"
                  src={previewSrc}
                  sandbox="allow-scripts allow-same-origin allow-forms"
                />
              )}
            </div>
            {!activeFile && editorView === 'code' && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
                {isSharedMode
                  ? 'Select a file from the shared project to start editing.'
                  : 'Select a module or UI entity from the explorer to start editing.'}
              </div>
            )}
          </div>
          </main>
        </div>

        <div className="flex h-7 items-center justify-between border-t border-[#2a2d2e] bg-[#252526] px-3 text-[11px] text-gray-300">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-gray-200 leading-none">
              {activeFile ? activeFile.name : 'No file selected'}
            </span>
            {activeFile && (
              <span className="flex h-5 items-center rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-[10px] uppercase tracking-wide text-gray-300">
                {activeFileType}
              </span>
            )}
            {activeFile?.meta?.kind === 'ui' && (
              <div className="flex items-center gap-2">
                <span className="flex h-5 items-center rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-[10px] uppercase tracking-wide">
                  UI Entity
                </span>
                <span className="text-gray-200 leading-none">{activeFile.meta.name}</span>
              </div>
            )}
            {activeFile?.meta?.kind === 'module' && (
              <div className="flex items-center gap-2">
                <span className="flex h-5 items-center rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-[10px] uppercase tracking-wide">
                  {activeFile.meta.method}
                </span>
                <span className="text-gray-200 leading-none">{activeFile.meta.routePath}</span>
              </div>
            )}
            {activeFile?.meta?.kind === 'shared' && (
              <div className="flex items-center gap-2">
                <span className="flex h-5 items-center rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-[10px] uppercase tracking-wide">
                  Shared
                </span>
                <span className="text-gray-200 leading-none">{activeFile.meta.path}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeFile && (
              <>
                <span className="text-gray-400 leading-none">Language</span>
                <select
                  value={
                    LANGUAGE_OPTIONS.some((option) => option.value === activeFile.language)
                      ? activeFile.language
                      : 'javascript'
                  }
                  onChange={(e) => handleLanguageChange(e.target.value as EditorLanguage)}
                  className="h-5 rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-[11px] text-gray-200 focus:border-sky-500 focus:outline-none"
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>
        {renderTabContextMenu()}
      </div>

      <Modal
        open={createModalOpen}
        onClose={closeCreateModal}
        title={
          createType === 'folder'
            ? `Create folder (${
                createScope === 'shared'
                  ? 'Shared Project'
                  : createScope === 'modules'
                  ? 'Modules'
                  : 'UI Entities'
              })`
            : createScope === 'modules'
            ? 'Create module'
            : createScope === 'shared'
            ? 'Create shared file'
            : 'Create UI entity'
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeCreateModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateSubmit}>
              Create
            </Button>
          </div>
        }
      >
        {createType === 'folder' ? (
          <FormLayout>
            <Input
              label="Folder name"
              value={folderForm.name}
              onChange={(e) => setFolderForm({ name: e.target.value })}
              placeholder="New folder"
            />
          </FormLayout>
        ) : createScope === 'modules' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateSubmit();
            }}
            className="space-y-4"
          >
            <FormLayout
              gridClassName="grid gap-4 md:grid-cols-2"
            >
              <Input
                label="Route path"
                value={moduleForm.routePath}
                onChange={(e) => setModuleForm({ ...moduleForm, routePath: e.target.value })}
                placeholder="/api/example"
              />
              <Select
                label="Method"
                value={moduleForm.method}
                onChange={(e) => setModuleForm({ ...moduleForm, method: e.target.value })}
                options={MODULE_METHOD_OPTIONS.map((method) => ({
                  label: method,
                  value: method,
                }))}
              />
              <Select
                label="File extension"
                value={moduleForm.fileExtension}
                onChange={(e) =>
                  setModuleForm({ ...moduleForm, fileExtension: e.target.value })
                }
                options={FILE_EXTENSION_OPTIONS.map((ext) => ({
                  label: ext,
                  value: ext,
                }))}
              />
              <div className="md:col-span-2">
                <TextArea
                  label="Module code"
                  value={moduleForm.code}
                  onChange={(e) => setModuleForm({ ...moduleForm, code: e.target.value })}
                />
              </div>
            </FormLayout>
          </form>
        ) : createScope === 'shared' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateSubmit();
            }}
            className="space-y-4"
          >
            <FormLayout>
              <Input
                label="File path"
                value={sharedFileForm.path}
                onChange={(e) =>
                  setSharedFileForm((prev) => ({ ...prev, path: e.target.value }))
                }
                placeholder="src/new-file.tsx"
              />
              <TextArea
                label="Initial content (optional)"
                value={sharedFileForm.content}
                onChange={(e) =>
                  setSharedFileForm((prev) => ({ ...prev, content: e.target.value }))
                }
                rows={6}
              />
            </FormLayout>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateSubmit();
            }}
            className="space-y-4"
          >
            <FormLayout
              gridClassName="grid gap-4 md:grid-cols-2"
            >
              <Input
                label="Name"
                value={uiForm.name}
                onChange={(e) => setUiForm({ ...uiForm, name: e.target.value })}
                placeholder="components/Button"
              />
              <Input
                label="Version"
                value={uiForm.version}
                onChange={(e) => setUiForm({ ...uiForm, version: e.target.value })}
                placeholder="1.0.0"
              />
              <Select
                label="File extension"
                value={uiForm.fileExtension}
                onChange={(e) => {
                  const nextExtension = e.target.value;
                  setUiForm((prev) => {
                    const next = { ...prev, fileExtension: nextExtension };
                    if (nextExtension === 'css' && prev.code === DEFAULT_UI_CODE) {
                      next.code = DEFAULT_CSS_CODE;
                    } else if (nextExtension !== 'css' && prev.code === DEFAULT_CSS_CODE) {
                      next.code = DEFAULT_UI_CODE;
                    }
                    return next;
                  });
                }}
                options={UI_EXTENSION_OPTIONS.map((ext) => ({
                  label: ext,
                  value: ext,
                }))}
              />
              <div className="md:col-span-2">
                <TextArea
                  label="Dependencies (comma or newline separated)"
                  value={uiForm.dependencies}
                  onChange={(e) => setUiForm({ ...uiForm, dependencies: e.target.value })}
                  placeholder="react, react-dom"
                />
              </div>
              <div className="md:col-span-2">
                <TextArea
                  label="Source code"
                  value={uiForm.code}
                  onChange={(e) => setUiForm({ ...uiForm, code: e.target.value })}
                />
              </div>
            </FormLayout>
          </form>
        )}
      </Modal>

      <Modal
        open={closePromptOpen}
        onClose={() => {
          if (pendingCloseBusy) return;
          setClosePromptOpen(false);
          setPendingCloseIds([]);
          setPendingCloseAction(null);
        }}
        title="Unsaved changes"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                if (pendingCloseBusy) return;
                setClosePromptOpen(false);
                setPendingCloseIds([]);
                setPendingCloseAction(null);
              }}
              disabled={pendingCloseBusy}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (pendingCloseBusy) return;
                if (pendingCloseAction === 'reload') {
                  setPendingCloseIds([]);
                  setPendingCloseAction(null);
                  setClosePromptOpen(false);
                  window.location.reload();
                  return;
                }
                closeTabsByIds(new Set(pendingCloseIds));
                setPendingCloseIds([]);
                setPendingCloseAction(null);
                setClosePromptOpen(false);
              }}
              disabled={pendingCloseBusy}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (pendingCloseBusy) return;
                setPendingCloseBusy(true);
                for (const file of pendingDirtyFiles) {
                  await handleSaveFile(file);
                }
                if (pendingCloseAction === 'reload') {
                  setPendingCloseIds([]);
                  setPendingCloseAction(null);
                  setClosePromptOpen(false);
                  setPendingCloseBusy(false);
                  window.location.reload();
                  return;
                }
                closeTabsByIds(new Set(pendingCloseIds));
                setPendingCloseIds([]);
                setPendingCloseAction(null);
                setClosePromptOpen(false);
                setPendingCloseBusy(false);
              }}
              disabled={pendingCloseBusy}
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-sm text-gray-300">
          <p>
            You have {pendingDirtyFiles.length} unsaved file
            {pendingDirtyFiles.length === 1 ? '' : 's'}.
          </p>
          {pendingDirtyFiles.length > 0 && (
            <div className="max-h-32 overflow-auto rounded border border-[#2a2d2e] bg-[#1f1f1f] px-3 py-2 text-[11px] text-gray-200">
              {pendingDirtyFiles.map((file) => (
                <div key={file.id} className="truncate">
                  {file.name}
                </div>
              ))}
            </div>
          )}
          <p>
            Do you want to save your changes before{' '}
            {pendingCloseAction === 'reload' ? 'reloading' : 'closing'}?
          </p>
        </div>
      </Modal>

      <Modal
        open={editModalOpen}
        onClose={closeEditModal}
        title={
          editMeta?.kind === 'module'
            ? 'Edit module'
            : editMeta?.kind === 'shared'
            ? 'Edit shared file'
            : 'Edit UI entity'
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeEditModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleEditSubmit}>
              Save
            </Button>
          </div>
        }
      >
        {editMeta?.kind === 'module' ? (
          <FormLayout gridClassName="grid gap-4 md:grid-cols-2">
            <Input
              label="Route path"
              value={editModuleForm.routePath}
              onChange={(e) =>
                setEditModuleForm({ ...editModuleForm, routePath: e.target.value })
              }
              placeholder="/api/example"
            />
            <Select
              label="Method"
              value={editModuleForm.method}
              onChange={(e) =>
                setEditModuleForm({ ...editModuleForm, method: e.target.value })
              }
              options={MODULE_METHOD_OPTIONS.map((method) => ({
                label: method,
                value: method,
              }))}
            />
            <Select
              label="File extension"
              value={editModuleForm.fileExtension}
              onChange={(e) =>
                setEditModuleForm({ ...editModuleForm, fileExtension: e.target.value })
              }
              options={FILE_EXTENSION_OPTIONS.map((ext) => ({
                label: ext,
                value: ext,
              }))}
            />
          </FormLayout>
        ) : editMeta?.kind === 'shared' ? (
          <FormLayout>
            <Input
              label="File path"
              value={editSharedPath}
              onChange={(e) => setEditSharedPath(e.target.value)}
              placeholder="src/file.tsx"
            />
          </FormLayout>
        ) : (
          <FormLayout gridClassName="grid gap-4 md:grid-cols-2">
            <Input
              label="Name"
              value={editUiForm.name}
              onChange={(e) => setEditUiForm({ ...editUiForm, name: e.target.value })}
              placeholder="components/Button"
            />
            <Input
              label="Version"
              value={editUiForm.version}
              onChange={(e) => setEditUiForm({ ...editUiForm, version: e.target.value })}
              placeholder="1.0.0"
            />
            <Select
              label="File extension"
              value={editUiForm.fileExtension}
              onChange={(e) =>
                setEditUiForm({ ...editUiForm, fileExtension: e.target.value })
              }
              options={UI_EXTENSION_OPTIONS.map((ext) => ({
                label: ext,
                value: ext,
              }))}
            />
            <div className="md:col-span-2">
              <TextArea
                label="Dependencies (comma or newline separated)"
                value={editUiForm.dependencies}
                onChange={(e) =>
                  setEditUiForm({ ...editUiForm, dependencies: e.target.value })
                }
              />
            </div>
          </FormLayout>
        )}
      </Modal>

      <Modal
        open={renameFolderOpen}
        onClose={closeRenameFolderModal}
        title="Rename folder"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeRenameFolderModal}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleRenameFolderSubmit}>
              Rename
            </Button>
          </div>
        }
      >
        <FormLayout>
          <Input
            label="Folder name"
            value={renameFolderName}
            onChange={(e) => setRenameFolderName(e.target.value)}
          />
        </FormLayout>
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={closeDeleteModal}
        title="Delete"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeDeleteModal}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteSubmit}>
              Delete
            </Button>
          </div>
        }
      >
        <p className="text-sm text-textMuted">
          {deleteTarget?.type === 'folder'
            ? `Delete folder "${deleteTarget.label}" and everything inside it?`
            : `Delete "${deleteTarget?.label}"?`}
        </p>
      </Modal>

      <style jsx global>{`
        .monaco-editor .monaco-search-match {
          background-color: rgba(11, 91, 150, 0.3);
          border: 1px solid rgba(11, 91, 150, 0.55);
        }
        .monaco-editor .monaco-search-current {
          background-color: rgba(11, 91, 150, 0.55);
          border: 1px solid rgba(11, 91, 150, 0.9);
        }
      `}</style>
    </>
  );
}
