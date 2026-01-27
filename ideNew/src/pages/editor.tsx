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
    };

type PreviewTarget = Extract<NodeMeta, { kind: 'ui' }>;

type ModuleDto = {
  id: string;
  routePath: string;
  method: string;
  code: string;
  fileExtension?: string;
};

type UIPackageDto = {
  id: string;
  name: string;
  version: string;
  code?: string;
  codeBlob: string;
  dependencies: string[];
  fileExtension?: string;
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

type ExplorerScope = 'modules' | 'ui';

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
  const version = pkg.version || 'latest';
  return `${sanitizeForFilename(baseName)}@${sanitizeForFilename(version)}.ui.${coerceUiExtension(pkg.fileExtension)}`;
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
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [savedContents, setSavedContents] = useState<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);
  const [openFiles, setOpenFiles] = useState<ActiveFile[]>([]);
  const [treeData, setTreeData] = useState<ExplorerNode | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState<string>('');
  const [modulesData, setModulesData] = useState<ModuleDto[]>([]);
  const [uiData, setUiData] = useState<UIPackageDto[]>([]);
  const [folderOverrides, setFolderOverrides] = useState<FolderOverride[]>([]);
  const [tenantHost, setTenantHost] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'folder' | null>(null);
  const [createScope, setCreateScope] = useState<ExplorerScope | null>(null);
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
  const [renameFolderOpen, setRenameFolderOpen] = useState(false);
  const [renameFolderScope, setRenameFolderScope] = useState<ExplorerScope | null>(null);
  const [renameFolderPath, setRenameFolderPath] = useState<string[]>([]);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: 'file'; scope: ExplorerScope; meta: NodeMeta; label: string }
    | { type: 'folder'; scope: ExplorerScope; path: string[]; label: string }
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
  const [leftPanel, setLeftPanel] = useState<'explorer' | 'history' | 'search'>(
    'explorer'
  );
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
      const res = await fetch(url, {
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
  }, [tenantHost]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!tenantHost) return;
    localStorage.setItem(
      `${FOLDER_STORAGE_KEY}:${tenantHost}`,
      JSON.stringify(folderOverrides)
    );
  }, [folderOverrides, tenantHost]);

  useEffect(() => {
    if (!treeData) return;
    setTreeData(buildExplorerTree(modulesData, uiData, folderOverrides));
  }, [folderOverrides, modulesData, uiData]);


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
    if (!ready || !token) return;
    loadTree();
  }, [loadTree, ready, token]);

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
      if (!candidate.startsWith('module-') && !candidate.startsWith('ui-')) return null;
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

  const saveFile = useCallback(
    async (file: ActiveFile) => {
      if (!file.meta) return;
      const content = fileContents[file.id] ?? savedContents[file.id] ?? '';
      if (file.meta.kind === 'module') {
        await apiFetch(`/api/modules/${file.meta.backendId}`, {
          method: 'PUT',
          body: {
            routePath: file.meta.routePath,
            method: file.meta.method,
            code: content,
            fileExtension: coerceModuleExtension(file.meta.fileExtension),
          },
        });
      } else {
        const uiExtension = coerceUiExtension(file.meta.fileExtension);
        if (uiExtension !== 'css' && !window.Babel) {
          throw new Error('Babel runtime not loaded in browser; cannot build code_blob');
        }
        const compiled = uiExtension === 'css' ? content : compileWithBabel(content);
        await apiFetch(`/api/ui-entities/${file.meta.backendId}`, {
          method: 'PUT',
          body: {
            name: file.meta.name,
            version: file.meta.version,
            code: content,
            codeBlob: compiled,
            dependencies: file.meta.dependencies ?? [],
            fileExtension: uiExtension,
          },
        });
      }
      setSavedContents((prev) => ({ ...prev, [file.id]: content }));
    },
    [apiFetch, fileContents, savedContents]
  );

  const handleSaveFile = useCallback(
    async (file: ActiveFile) => {
      if (!file.meta) return;
      try {
        await saveFile(file);
        success('Saved');
        loadTree();
        if (activeFile?.id === file.id) {
          loadHistory();
        }
      } catch (err) {
        showError((err as Error).message || 'Save failed');
      }
    },
    [activeFile?.id, loadHistory, loadTree, saveFile, showError, success]
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
    loadTree();
    if (savedActive) {
      loadHistory();
    }
  }, [
    activeFile?.id,
    isFileDirty,
    loadHistory,
    loadTree,
    openFiles,
    saveFile,
    showError,
    success,
  ]);

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
        loadTree();
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
  }, [activeFile, handleSave, loadHistory, loadTree, requestReload]);


  const resetActionFeedback = () => {};

  const openCreateModal = (
    scope: ExplorerScope,
    type: 'file' | 'folder',
    parentPath: string[]
  ) => {
    resetActionFeedback();
    setCreateScope(scope);
    setCreateType(type);
    setCreateParentPath(parentPath);
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
  };

  const handleCreateSubmit = async () => {
    if (!createScope || !createType) return;
    resetActionFeedback();
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
    if (meta.kind === 'module') {
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
  };

  const handleEditSubmit = async () => {
    if (!editMeta) return;
    resetActionFeedback();
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

  const openRenameFolderModal = (scope: ExplorerScope, path: string[]) => {
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
      if (renameFolderScope === 'modules') {
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
      | { type: 'file'; scope: ExplorerScope; meta: NodeMeta; label: string }
      | { type: 'folder'; scope: ExplorerScope; path: string[]; label: string }
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
        if (meta.kind === 'module') {
          await apiFetch(`/api/modules/${meta.backendId}`, { method: 'DELETE' });
        } else {
          await apiFetch(`/api/ui-entities/${meta.backendId}`, { method: 'DELETE' });
        }
        success('File deleted');
      } else {
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
      const scopeInfo = getScopeInfo(parentPath);
      if (!scopeInfo.scope) {
        const message = 'Create items inside Modules or UI Entities.';
        showError(message);
        return true;
      }
      openCreateModal(scopeInfo.scope, type, scopeInfo.path);
      return true;
    },
    [openCreateModal, showError]
  );

  const handleRenameRequest = useCallback(
    ({
      node,
      parentPath,
    }: {
      node: ExplorerNode;
      parentPath: ExplorerNode[];
    }) => {
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
    [openEditModal, openRenameFolderModal]
  );

  const handleDeleteRequest = useCallback(
    ({
      node,
      parentPath,
    }: {
      node: ExplorerNode;
      parentPath: ExplorerNode[];
    }) => {
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
    [openDeleteModal]
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
    [apiFetch, folderOverrides, loadTree, modulesData, showError, treeData, uiData]
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
  }, [editorView, previewTarget?.backendId, previewTarget?.version, tenantHost]);

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
      } else {
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
      }
      success('Rolled back');
      loadTree();
      loadHistory();
    } catch (err) {
      const message = (err as Error).message || 'Rollback failed';
      showError(message);
    }
  };

  const handleSwitchToPreview = useCallback(() => {
    if (activeFile && activeFile.meta && activeFile.meta.kind === 'ui') {
      setPreviewTarget(activeFile.meta);
    }
    setEditorView('preview');
  }, [activeFile]);

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

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-[#2a2d2e] bg-[#1f1f1f] p-0.5 text-[10px] uppercase tracking-wide text-gray-300">
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

          <div className="ml-auto flex items-center gap-2 text-[11px]">
            <Link
              href="/admin/tenants"
              className="hidden sm:inline-flex rounded-full border border-[#2a2d2e] px-3 py-1 text-gray-200 hover:bg-[#1f1f1f]"
            >
              Manage tenants
            </Link>
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
            <div className="mt-auto flex w-full flex-col items-center px-1 pb-2">
              <div
                className={`flex w-full flex-col items-center gap-2 px-1 py-2 text-[10px] ${
                  tenantHost ? 'text-gray-200' : 'text-red-200'
                }`}
                title={tenantHost ? tenantHost : 'No tenant selected'}
              >
                <span
                  className="font-semibold"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                >
                  {tenantHost ? tenantHost : 'None'}
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
                      onClick={() => loadTree()}
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
                      disabled={historyLoading || !activeFile?.meta}
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
            <div className="relative flex h-[34px] items-stretch border-b border-[#2a2d2e] bg-[#252526]">
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
                  Select a UI entity to preview.
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
                Select a module or UI entity from the explorer to start editing.
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
                <span className="text-gray-200 leading-none">
                  {activeFile.meta.name}@{activeFile.meta.version}
                </span>
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
            ? `Create folder (${createScope === 'modules' ? 'Modules' : 'UI Entities'})`
            : createScope === 'modules'
            ? 'Create module'
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
        title={editMeta?.kind === 'module' ? 'Edit module' : 'Edit UI entity'}
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
