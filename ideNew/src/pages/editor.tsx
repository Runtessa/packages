import '@/lib/monaco';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/router';
import type * as monaco from 'monaco-editor';
import { ExplorerNode } from '@/components/FileExplorer';
import { useToast } from '@/components/ui/Toast';
import { useSessionToken } from '@/lib/client/session';
import { getSelectedTenantHost } from '@/lib/client/tenant';
import branding from '@/branding.json';
import { EditorHeader } from '@/components/editor/EditorHeader';
import { EditorSidebar } from '@/components/editor/EditorSidebar';
import { EditorExplorerPanel } from '@/components/editor/EditorExplorerPanel';
import { EditorHistoryPanel } from '@/components/editor/EditorHistoryPanel';
import { EditorSearchPanel } from '@/components/editor/EditorSearchPanel';
import { EditorStagingPanel } from '@/components/editor/EditorStagingPanel';
import { EditorAiPanel } from '@/components/editor/EditorAiPanel';
import { EditorBottomBar } from '@/components/editor/EditorBottomBar';
import { EditorTabBar } from '@/components/editor/EditorTabBar';
import { EditorTabContextMenu } from '@/components/editor/EditorTabContextMenu';
import { EditorWorkspace } from '@/components/editor/EditorWorkspace';
import { EditorModals } from '@/components/editor/EditorModals';
import {
  ASSISTANT_PANEL_OPEN_STORAGE_KEY,
  ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
  DEFAULT_ASSISTANT_PANEL_WIDTH,
  DEFAULT_CSS_CODE,
  DEFAULT_LEFT_PANEL_WIDTH,
  DEFAULT_MODEL_CODE,
  DEFAULT_MODEL_EXTENSION,
  DEFAULT_MODULE_CODE,
  DEFAULT_PREVIEW_PORT,
  DEFAULT_SHARED_FILE,
  DEFAULT_SPLIT_RATIO,
  DEFAULT_UI_EXTENSION,
  DEFAULT_UI_CODE,
  FOLDER_STORAGE_KEY,
  HISTORY_PAGE_SIZE,
  LANGUAGE_OPTIONS,
  LEFT_PANEL_STORAGE_KEY,
  MAX_ASSISTANT_PANEL_WIDTH,
  MAX_LEFT_PANEL_WIDTH,
  MIN_ASSISTANT_PANEL_WIDTH,
  MIN_LEFT_PANEL_WIDTH,
  MIN_SPLIT_PX,
  MODULE_EXTENSION,
  PREVIEW_PORT_STORAGE_KEY,
  SHARED_FOLDER_STORAGE_KEY,
  SPLIT_RATIO_STORAGE_KEY,
} from '@/components/editor/constants';
import {
  buildExplorerTree,
  buildPersistedContentMap,
  buildRoutePath,
  buildSearchPattern,
  buildSearchResults,
  buildSharedBundle,
  buildSharedContentMap,
  buildSharedTree,
  buildUiName,
  coerceModuleExtension,
  coerceUiExtension,
  compileWithBabel,
  detectLanguage,
  escapeRegExp,
  extractFileExtension,
  extractUiDependencies,
  findPathById,
  formatHistoryTimestamp,
  getFileIdFromUriPath,
  getRevisionContent,
  getScopeInfo,
  getSharedNodeId,
  getSharedPathFromNodes,
  normalizeModelPath,
  normalizeSharedPath,
  parseDependencies,
  parseFilterRegex,
  pathStartsWith,
  resolveSharedExtension,
  replaceAtRange,
  splitRoutePath,
  splitSharedPath,
  splitUiName,
  splitModelPath,
} from '@/components/editor/utils';
import type {
  ActiveFile,
  DeleteTarget,
  EditorLanguage,
  FolderOverride,
  FolderFormState,
  HistoryItem,
  ModelFormState,
  ModuleDto,
  ModuleFormState,
  NodeMeta,
  OrmModelDto,
  PanelScope,
  PreviewTarget,
  SearchMatchRange,
  SearchResult,
  SharedFileDto,
  SharedFileFormState,
  SharedProjectDto,
  StagingItem,
  TabContextMenuState,
  UiFormState,
  UIPackageDto,
  ModuleRevisionDto,
  UiRevisionDto,
  AclConfigDto,
} from '@/components/editor/types';

const CORE_API_BASE = process.env.NEXT_PUBLIC_CORE_API_URL?.trim() || '';
const PREVIEW_EXCEPTION_BATCH_DELAY_MS = 800;
const PREVIEW_EXCEPTION_DEDUPE_MS = 3000;
const PREVIEW_EXCEPTION_MAX_QUEUE = 40;

declare global {
  interface Window {
    Babel?: {
      transform: (code: string, opts: Record<string, unknown>) => { code: string };
    };
  }
}

type HistoryResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

type AssistantDiffPreview = {
  id: string;
  path: string;
  before: string;
  after: string;
  language: string;
};

type PreviewExceptionPayload = {
  id?: string;
  kind?: string;
  level?: 'error' | 'warn' | 'info' | string;
  message?: string;
  stack?: string;
  sourceUrl?: string;
  line?: number | null;
  column?: number | null;
  requestUrl?: string;
  method?: string;
  status?: number | null;
  responseSnippet?: string;
  previewName?: string;
  previewVersion?: string;
  previewSession?: string;
  tenantHost?: string;
  href?: string;
  createdAt?: string;
};

export default function EditorPage() {
  const router = useRouter();
  const { token, clear, ready } = useSessionToken();
  const { success, error: showError } = useToast();
  const MODULE_JSDOC = `/** @type {IdpModuleHandler} */\n`;
  const ensureModuleTyping = useCallback((content: string) => {
    if (!content) return content;
    if (
      content.includes('IdpModuleHandler') ||
      content.includes('@type {IdpModuleHandler}') ||
      content.includes('@param {IdpAdapters}') ||
      content.includes('IdpAdapters') ||
      content.includes('@typedef {IdpAdapters')
    ) {
      return content;
    }
    const marker = 'module.exports';
    const idx = content.indexOf(marker);
    if (idx === -1) return content;
    return `${content.slice(0, idx)}${MODULE_JSDOC}${content.slice(idx)}`;
  }, []);
  const sharedUiProjectId = useMemo(() => {
    if (!router.isReady) return null;
    const value = router.query.sharedProject;
    return typeof value === 'string' && value.trim() ? value : null;
  }, [router.isReady, router.query.sharedProject]);
  const sharedModuleProjectId = useMemo(() => {
    if (!router.isReady) return null;
    const value = router.query.sharedModule;
    return typeof value === 'string' && value.trim() ? value : null;
  }, [router.isReady, router.query.sharedModule]);
  const sharedMode = sharedModuleProjectId
    ? 'module'
    : sharedUiProjectId
    ? 'ui'
    : null;
  const sharedProjectId = sharedMode === 'module' ? sharedModuleProjectId : sharedUiProjectId;
  const isSharedMode = Boolean(sharedMode);
  const sharedBasePath =
    sharedMode === 'module' ? '/api/admin/shared-modules' : '/api/admin/shared-packages';
  const sharedRootLabel =
    sharedMode === 'module' ? 'Shared Backend Project' : 'Shared Project';
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [savedContents, setSavedContents] = useState<Record<string, string>>({});
  const savedContentsRef = useRef<Record<string, string>>({});
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);
  const [openFiles, setOpenFiles] = useState<ActiveFile[]>([]);
  const [treeData, setTreeData] = useState<ExplorerNode | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState<string>('');
  const loadTreeInFlightRef = useRef(false);
  const [modulesData, setModulesData] = useState<ModuleDto[]>([]);
  const [modelsData, setModelsData] = useState<OrmModelDto[]>([]);
  const [uiData, setUiData] = useState<UIPackageDto[]>([]);
  const [aclConfig, setAclConfig] = useState<AclConfigDto | null>(null);
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
  const [modelForm, setModelForm] = useState<ModelFormState>({
    path: 'models/ExampleItem.js',
    fileExtension: DEFAULT_MODEL_EXTENSION,
    code: DEFAULT_MODEL_CODE,
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
  const [editModelForm, setEditModelForm] = useState<ModelFormState>({
    path: '',
    fileExtension: DEFAULT_MODEL_EXTENSION,
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
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
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
  const [editorDropTarget, setEditorDropTarget] = useState<'left' | 'right' | null>(
    null
  );
  const [leftPanel, setLeftPanel] = useState<
    'explorer' | 'history' | 'search' | 'staging'
  >('explorer');
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem(ASSISTANT_PANEL_OPEN_STORAGE_KEY);
    if (stored === null) return false;
    return stored === '1';
  });
  const [assistantPanelWidth, setAssistantPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_ASSISTANT_PANEL_WIDTH;
    const stored = localStorage.getItem(ASSISTANT_PANEL_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_ASSISTANT_PANEL_WIDTH;
  });
  const [stagingBusy, setStagingBusy] = useState(false);
  const [stagingBusyId, setStagingBusyId] = useState<string | null>(null);
  const [modelMigrationBusy, setModelMigrationBusy] = useState(false);
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
  const assistantPanelWidthRef = useRef(assistantPanelWidth);
  const assistantResizeRef = useRef<{
    active: boolean;
    startX: number;
    startWidth: number;
  }>({
    active: false,
    startX: 0,
    startWidth: DEFAULT_ASSISTANT_PANEL_WIDTH,
  });
  const mainEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const sideEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const handleSaveRef = useRef<() => void>(() => {});
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
  const [assistantDiff, setAssistantDiff] = useState<AssistantDiffPreview | null>(
    null
  );

  const [editorView, setEditorView] = useState<'code' | 'preview'>('code');
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const previewSession = useMemo(
    () => `${previewTarget?.name || 'preview'}-${previewNonce}`,
    [previewNonce, previewTarget?.name]
  );
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const previewExceptionQueueRef = useRef<PreviewExceptionPayload[]>([]);
  const previewExceptionFlushTimerRef = useRef<number | null>(null);
  const previewExceptionLastSeenRef = useRef<Record<string, number>>({});
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
  const sharedLabelFallback =
    sharedMode === 'module' ? 'Shared Backend Project' : 'Shared Project';
  const sidebarLabel = isSharedMode
    ? sharedProject?.name || sharedLabelFallback
    : tenantHost || 'None';
  const sidebarLabelTone = isSharedMode
    ? 'text-gray-200'
    : tenantHost
      ? 'text-gray-200'
      : 'text-red-200';
  const exitHref =
    sharedMode === 'module'
      ? '/admin/shared-modules'
      : sharedMode === 'ui'
      ? '/admin/shared-packages'
      : '/admin/tenants';
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
  const handleTabContextMenu = useCallback(
    (file: ActiveFile, pane: 'left' | 'right', event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (pane === 'left') {
        setActiveFile(file);
      } else {
        setSideFileId(file.id);
      }
      setTabMenu({ x: event.clientX, y: event.clientY, fileId: file.id });
    },
    []
  );

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

  const apiStreamFetch = useCallback(
    async (
      url: string,
      options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
    ) => {
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
        signal: options.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(tenantHost ? { 'X-Tenant-Host': tenantHost } : {}),
          ...(token ? { Authorization: `Session ${token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      if (!res.ok) {
        if (res.status === 401) {
          clear();
        }
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        throw new Error(data.error || 'Request failed');
      }
      return res;
    },
    [clear, resolveApiUrl, token]
  );

  const flushPreviewExceptionQueue = useCallback(async () => {
    if (previewExceptionFlushTimerRef.current !== null) {
      window.clearTimeout(previewExceptionFlushTimerRef.current);
      previewExceptionFlushTimerRef.current = null;
    }
    const queued = previewExceptionQueueRef.current.splice(0, PREVIEW_EXCEPTION_MAX_QUEUE);
    if (!queued.length) return;
    try {
      await apiFetch('/api/assistant/preview/exceptions', {
        method: 'POST',
        body: { events: queued },
      });
    } catch {
      // Keep preview telemetry non-blocking for editor UX.
    }
  }, [apiFetch]);

  useEffect(() => {
    const scheduleFlush = () => {
      if (previewExceptionFlushTimerRef.current !== null) return;
      previewExceptionFlushTimerRef.current = window.setTimeout(() => {
        void flushPreviewExceptionQueue();
      }, PREVIEW_EXCEPTION_BATCH_DELAY_MS);
    };

    const handlePreviewMessage = (event: MessageEvent) => {
      const frameWindow = previewFrameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const source = String((data as { source?: string }).source || '');
      if (source !== 'idp-preview-exception') return;

      const payloadCandidate = (data as { payload?: unknown }).payload;
      const payload =
        payloadCandidate && typeof payloadCandidate === 'object'
          ? (payloadCandidate as PreviewExceptionPayload)
          : null;
      if (!payload) return;

      const message = String(payload.message || '').trim();
      if (!message) return;
      if (payload.previewSession && payload.previewSession !== previewSession) return;

      const dedupeKey = [
        String(payload.kind || ''),
        message,
        String(payload.requestUrl || ''),
        String(payload.status ?? ''),
        String(payload.sourceUrl || ''),
        String(payload.line ?? ''),
        String(payload.column ?? ''),
      ].join('|');
      const now = Date.now();
      const lastSeen = previewExceptionLastSeenRef.current[dedupeKey] || 0;
      if (now - lastSeen < PREVIEW_EXCEPTION_DEDUPE_MS) return;
      previewExceptionLastSeenRef.current[dedupeKey] = now;

      previewExceptionQueueRef.current.push({
        id: payload.id,
        kind: payload.kind || 'runtime-error',
        level: payload.level || 'error',
        message,
        stack: payload.stack || '',
        sourceUrl: payload.sourceUrl || '',
        line:
          typeof payload.line === 'number' && Number.isFinite(payload.line)
            ? payload.line
            : null,
        column:
          typeof payload.column === 'number' && Number.isFinite(payload.column)
            ? payload.column
            : null,
        requestUrl: payload.requestUrl || '',
        method: payload.method || '',
        status:
          typeof payload.status === 'number' && Number.isFinite(payload.status)
            ? payload.status
            : null,
        responseSnippet: payload.responseSnippet || '',
        previewName: payload.previewName || previewTarget?.name || '',
        previewVersion: payload.previewVersion || previewTarget?.version || '',
        previewSession: payload.previewSession || previewSession,
        tenantHost: payload.tenantHost || tenantHost || '',
        href: payload.href || '',
        createdAt: payload.createdAt || new Date().toISOString(),
      });
      if (previewExceptionQueueRef.current.length >= PREVIEW_EXCEPTION_MAX_QUEUE) {
        void flushPreviewExceptionQueue();
        return;
      }
      scheduleFlush();
    };

    window.addEventListener('message', handlePreviewMessage);
    return () => {
      window.removeEventListener('message', handlePreviewMessage);
      void flushPreviewExceptionQueue();
    };
  }, [
    flushPreviewExceptionQueue,
    previewSession,
    previewTarget?.name,
    previewTarget?.version,
    tenantHost,
  ]);

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
    if (typeof window === 'undefined') return;
    localStorage.setItem(
      ASSISTANT_PANEL_OPEN_STORAGE_KEY,
      assistantPanelOpen ? '1' : '0'
    );
  }, [assistantPanelOpen]);

  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth;
  }, [leftPanelWidth]);

  useEffect(() => {
    assistantPanelWidthRef.current = assistantPanelWidth;
  }, [assistantPanelWidth]);

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
      if (!assistantResizeRef.current.active) return;
      const delta = assistantResizeRef.current.startX - event.clientX;
      const nextWidth = Math.min(
        MAX_ASSISTANT_PANEL_WIDTH,
        Math.max(MIN_ASSISTANT_PANEL_WIDTH, assistantResizeRef.current.startWidth + delta)
      );
      setAssistantPanelWidth(nextWidth);
    };

    const handleUp = () => {
      if (!assistantResizeRef.current.active) return;
      assistantResizeRef.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          ASSISTANT_PANEL_WIDTH_STORAGE_KEY,
          String(assistantPanelWidthRef.current)
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
    setTreeData(buildExplorerTree(modulesData, uiData, modelsData, folderOverrides, aclConfig));
  }, [aclConfig, folderOverrides, isSharedMode, modelsData, modulesData, uiData]);


  const loadSharedProject = useCallback(async () => {
    if (!sharedProjectId) return;
    setLoadingTree(true);
    setTreeError('');
    try {
      const [projectResponse, filesResponse] = await Promise.all([
        adminFetch(`${sharedBasePath}/${sharedProjectId}`),
        adminFetch(`${sharedBasePath}/${sharedProjectId}/files`),
      ]);
      const project = projectResponse.package as SharedProjectDto;
      const files = (filesResponse.files as SharedFileDto[]) || [];
      setSharedProject(project);
      setSharedFiles(files);
      setModulesData([]);
      setModelsData([]);
      setUiData([]);
      setAclConfig(null);
      setTreeData(
        buildSharedTree(project, files, sharedFolderOverrides, {
          rootLabel: sharedRootLabel,
          sharedKind: sharedMode ?? undefined,
        })
      );
      setSavedContents(buildSharedContentMap(files));
    } catch (err) {
      setTreeError((err as Error).message || 'Failed to load shared project');
    } finally {
      setLoadingTree(false);
    }
  }, [adminFetch, sharedBasePath, sharedFolderOverrides, sharedProjectId, sharedRootLabel, sharedMode]);

  const loadTree = useCallback(
    async (overrides: FolderOverride[] = folderOverrides) => {
      if (loadTreeInFlightRef.current) return;
      loadTreeInFlightRef.current = true;
      setLoadingTree(true);
      setTreeError('');
      try {
        const [modules, uiPackages, models, acl] = await Promise.all([
          apiFetch('/api/modules'),
          apiFetch('/api/ui-entities'),
          apiFetch('/api/models'),
          apiFetch('/api/acl/config'),
        ]);
        const moduleItems = modules as ModuleDto[];
        const uiItems = uiPackages as UIPackageDto[];
        const modelItems = models as OrmModelDto[];
        const normalizedAcl: AclConfigDto = {
          permissions: (acl as any)?.permissions ?? { permissions: [] },
          roles: (acl as any)?.roles ?? { roles: {} },
          endpoints: (acl as any)?.endpoints ?? {},
        };
        setModulesData(moduleItems);
        setModelsData(modelItems);
        setUiData(uiItems);
        setAclConfig(normalizedAcl);
        setTreeData(buildExplorerTree(moduleItems, uiItems, modelItems, overrides, normalizedAcl));
        setSavedContents(buildPersistedContentMap(moduleItems, uiItems, modelItems, normalizedAcl));
      } catch (err) {
        setTreeError((err as Error).message || 'Failed to load explorer');
      } finally {
        setLoadingTree(false);
        loadTreeInFlightRef.current = false;
      }
    },
    [apiFetch, folderOverrides]
  );

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
    setTreeData(
      buildSharedTree(sharedProject, sharedFiles, sharedFolderOverrides, {
        rootLabel: sharedRootLabel,
        sharedKind: sharedMode ?? undefined,
      })
    );
  }, [isSharedMode, sharedFiles, sharedFolderOverrides, sharedProject, sharedMode, sharedRootLabel]);

  useEffect(() => {
    if (!isSharedMode || !sharedProject) return;
    if (sharedMode === 'module') return;
    if (editorView !== 'preview') return;
    setPreviewTarget({
      kind: 'shared',
      name: sharedProject.name,
      version: sharedProject.version,
    });
  }, [editorView, isSharedMode, sharedProject, sharedMode]);

  useEffect(() => {
    if (sharedMode !== 'module') return;
    if (editorView === 'preview') {
      setEditorView('code');
    }
  }, [editorView, sharedMode]);

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
    const measure = () => {
      const height = container.getBoundingClientRect().height;
      if (height < 1) return;
      const rowHeight = 36;
      const nextSize = Math.max(1, Math.floor(height / rowHeight));
      setHistoryPageSize((prev) => (prev === nextSize ? prev : nextSize));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [leftPanel, leftPanelOpen]);

  const loadHistory = useCallback(
    async (page = historyPage) => {
    if (!activeFile?.meta) {
      setHistoryItems([]);
      setHistoryError('');
      setHistoryTotal(0);
      return;
    }
    if (
      activeFile.meta.kind === 'shared' ||
      activeFile.meta.kind === 'acl' ||
      activeFile.meta.kind === 'model'
    ) {
      setHistoryItems([]);
      setHistoryError('History is not available for this file.');
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
    const isModuleFile =
      meta?.kind === 'module' || (meta?.kind === 'shared' && meta.sharedKind === 'module');
    const rawServerContent = file.content ?? '';
    const serverContent = isModuleFile ? ensureModuleTyping(rawServerContent) : rawServerContent;
    const existingSaved = savedContents[file.id];
    const existingCurrent = fileContents[file.id];
    const hasLocalEdits =
      existingSaved !== undefined &&
      existingCurrent !== undefined &&
      existingCurrent !== existingSaved;
    const canUpgradeTyping =
      isModuleFile &&
      serverContent !== rawServerContent &&
      !hasLocalEdits &&
      (existingSaved === undefined || existingSaved === rawServerContent) &&
      (existingCurrent === undefined ||
        existingCurrent === rawServerContent ||
        existingCurrent === existingSaved);
    const persistedContent =
      existingSaved !== undefined && !canUpgradeTyping ? existingSaved : serverContent;
    const initialContent =
      existingCurrent !== undefined && !canUpgradeTyping ? existingCurrent : persistedContent;

    setFileContents((prev) => {
      if (prev[file.id] !== undefined && !canUpgradeTyping) return prev;
      if (prev[file.id] === initialContent) return prev;
      return { ...prev, [file.id]: initialContent };
    });

    setSavedContents((prev) => {
      if (prev[file.id] !== undefined && !canUpgradeTyping) return prev;
      if (prev[file.id] === persistedContent) return prev;
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

  useEffect(() => {
    if (!activeFile?.meta) return;
    const meta = activeFile.meta;
    const isModuleFile =
      meta.kind === 'module' || (meta.kind === 'shared' && meta.sharedKind === 'module');
    if (!isModuleFile) return;
    const fileId = activeFile.id;
    const current = fileContents[fileId] ?? savedContents[fileId];
    if (!current) return;
    const typed = ensureModuleTyping(current);
    if (typed === current) return;
    const saved = savedContents[fileId];
    const hasLocalEdits =
      saved !== undefined &&
      fileContents[fileId] !== undefined &&
      fileContents[fileId] !== saved;
    if (hasLocalEdits) return;
    setFileContents((prev) => ({ ...prev, [fileId]: typed }));
    setSavedContents((prev) => ({ ...prev, [fileId]: typed }));
  }, [activeFile?.id, activeFile?.meta, ensureModuleTyping, fileContents, savedContents]);

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
        !candidate.startsWith('model-') &&
        !candidate.startsWith('ui-') &&
        !candidate.startsWith('shared-') &&
        !candidate.startsWith('acl-')
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

  const handleToggleSide = useCallback(
    (id: string) => {
      setHistorySelectedId(null);
      if (rightPaneSet.has(id)) {
        moveTabToPane(id, 'left');
      } else {
        moveTabToPane(id, 'right');
      }
    },
    [moveTabToPane, rightPaneSet]
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
  const stagingPublishableCount = useMemo(
    () => stagingItems.filter((item) => !item.dirty).length,
    [stagingItems]
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

  const handleEditorDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = getDraggedTabId(event);
      if (!sourceId || !editorAreaRef.current) {
        setEditorDropTarget(null);
        return;
      }
      const rect = editorAreaRef.current.getBoundingClientRect();
      const isRightSide = event.clientX > rect.left + rect.width * 0.55;
      setEditorDropTarget(isRightSide ? 'right' : 'left');
      event.dataTransfer.dropEffect = 'move';
    },
    []
  );

  const handleEditorDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null;
      if (editorAreaRef.current && next && editorAreaRef.current.contains(next)) {
        return;
      }
      setEditorDropTarget(null);
    },
    []
  );

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
    setEditorDropTarget(null);
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
    setEditorDropTarget(null);
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
      await adminFetch(`${sharedBasePath}/${project.id}`, {
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
    [adminFetch, sharedBasePath]
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
          `${sharedBasePath}/${projectId}/files/${meta.fileId}`,
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
      if (meta.kind === 'acl') {
        let parsed: any;
        try {
          parsed = content.trim() ? JSON.parse(content) : {};
        } catch {
          throw new Error('ACL file must be valid JSON.');
        }
        const response = await apiFetch('/api/acl/config', {
          method: 'PUT',
          body: { file: meta.file, content: parsed },
        });
        const nextAcl: AclConfigDto = {
          permissions: (response as any)?.permissions ?? aclConfig?.permissions ?? { permissions: [] },
          roles: (response as any)?.roles ?? aclConfig?.roles ?? { roles: {} },
          endpoints: (response as any)?.endpoints ?? aclConfig?.endpoints ?? {},
        };
        setAclConfig(nextAcl);
        const normalizedContent =
          meta.file === 'permissions'
            ? JSON.stringify(nextAcl.permissions ?? {}, null, 2) + '\n'
            : meta.file === 'roles'
            ? JSON.stringify(nextAcl.roles ?? {}, null, 2) + '\n'
            : JSON.stringify(nextAcl.endpoints ?? {}, null, 2) + '\n';
        setFileContents((prev) => ({ ...prev, [file.id]: normalizedContent }));
        setSavedContents((prev) => ({ ...prev, [file.id]: normalizedContent }));
        return;
      }
      if (meta.kind === 'model') {
        await apiFetch(`/api/models/${meta.backendId}`, {
          method: 'PUT',
          body: {
            path: normalizeModelPath(meta.path),
            code: content,
            fileExtension: DEFAULT_MODEL_EXTENSION,
          },
        });
        setSavedContents((prev) => ({ ...prev, [file.id]: content }));
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
        const detectedDependencies = extractUiDependencies(content);
        await apiFetch(`/api/ui-entities/${meta.backendId}`, {
          method: 'PUT',
          body: {
            name: meta.name,
            version: meta.version,
            code: content,
            codeBlob: compiled,
            dependencies: detectedDependencies,
            fileExtension: uiExtension,
          },
        });
        setUiData((prev) =>
          prev.map((pkg) =>
            pkg.id === meta.backendId ? { ...pkg, dependencies: detectedDependencies } : pkg
          )
        );
      }
      setSavedContents((prev) => ({ ...prev, [file.id]: content }));
    },
    [
      adminFetch,
      apiFetch,
      aclConfig,
      fileContents,
      sharedBasePath,
      sharedProject,
      syncSharedPackage,
    ]
  );

  const runModelMigration = useCallback(
    async (adapterKey?: string, options?: { silent?: boolean }) => {
      if (modelMigrationBusy) return;
      setModelMigrationBusy(true);
      try {
        await apiFetch('/api/models/migrate', {
          method: 'POST',
          body: adapterKey ? { adapterKey } : {},
        });
        if (!options?.silent) {
          success('Database updated');
        }
      } catch (err) {
        const message = (err as Error).message || 'Migration failed';
        showError(message);
      } finally {
        setModelMigrationBusy(false);
      }
    },
    [apiFetch, modelMigrationBusy, showError, success]
  );

  const handleSaveFile = useCallback(
    async (file: ActiveFile) => {
      if (!file.meta) return;
      try {
        await saveFile(file);
        if (file.meta.kind === 'model') {
          await runModelMigration(undefined, { silent: true });
        }
        success('Saved');
        await reloadTree();
        if (
          activeFile?.id === file.id &&
          file.meta.kind !== 'shared' &&
          file.meta.kind !== 'acl' &&
          file.meta.kind !== 'model'
        ) {
          loadHistory();
        }
      } catch (err) {
        showError((err as Error).message || 'Save failed');
      }
    },
    [activeFile?.id, loadHistory, reloadTree, runModelMigration, saveFile, showError, success]
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
    const savedModel = dirtyFiles.some((file) => file.meta?.kind === 'model');
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
    if (!firstError && savedModel) {
      await runModelMigration(undefined, { silent: true });
    }
    await reloadTree();
    if (
      savedActive &&
      activeFile?.meta?.kind !== 'shared' &&
      activeFile?.meta?.kind !== 'acl' &&
      activeFile?.meta?.kind !== 'model'
    ) {
      loadHistory();
    }
  }, [
    activeFile?.id,
    activeFile?.meta?.kind,
    isFileDirty,
    loadHistory,
    reloadTree,
    openFiles,
    runModelMigration,
    saveFile,
    showError,
    success,
  ]);

  const handleCancelClosePrompt = useCallback(() => {
    if (pendingCloseBusy) return;
    setClosePromptOpen(false);
    setPendingCloseIds([]);
    setPendingCloseAction(null);
  }, [pendingCloseBusy]);

  const handleDiscardClosePrompt = useCallback(() => {
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
  }, [closeTabsByIds, pendingCloseAction, pendingCloseBusy, pendingCloseIds]);

  const handleSaveClosePrompt = useCallback(async () => {
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
  }, [
    closeTabsByIds,
    handleSaveFile,
    pendingCloseAction,
    pendingCloseBusy,
    pendingCloseIds,
    pendingDirtyFiles,
  ]);

  const publishStagingItem = useCallback(
    async (target: StagingItem) => {
      if (target.kind === 'module') {
        if (!target.backendId) {
          throw new Error('Module id is missing.');
        }
        await apiFetch(`/api/modules/${target.backendId}/publish`, { method: 'POST' });
        return 'Module published';
      }
      if (target.kind === 'ui') {
        if (!target.backendId) {
          throw new Error('UI entity id is missing.');
        }
        await apiFetch(`/api/ui-entities/${target.backendId}/publish`, { method: 'POST' });
        return 'UI entity published';
      }
      const projectId = target.projectId || sharedProject?.id;
      if (!projectId) {
        throw new Error('Shared project is not loaded.');
      }
      await adminFetch(`${sharedBasePath}/${projectId}/publish`, {
        method: 'POST',
      });
      const refreshed = await adminFetch(`${sharedBasePath}/${projectId}`);
      setSharedProject(refreshed.package ?? refreshed);
      return 'Shared project published';
    },
    [adminFetch, apiFetch, sharedBasePath, sharedProject?.id]
  );

  const publishTarget = useCallback(
    async (target: StagingItem) => {
      if (stagingBusy) return;
      try {
        setStagingBusy(true);
        setStagingBusyId(target.id);
        const message = await publishStagingItem(target);
        await reloadTree();
        success(message);
      } catch (err) {
        showError((err as Error).message || 'Publish failed');
      } finally {
        setStagingBusy(false);
        setStagingBusyId(null);
      }
    },
    [publishStagingItem, reloadTree, showError, stagingBusy, success]
  );

  const publishAllStagingTargets = useCallback(async () => {
    if (stagingBusy) return;
    const queue = stagingItems.filter((item) => !item.dirty);
    if (queue.length === 0) {
      showError('No publishable items. Save dirty files first.');
      return;
    }
    const failures: string[] = [];
    try {
      setStagingBusy(true);
      setStagingBusyId('__all__');
      for (const target of queue) {
        setStagingBusyId(target.id);
        try {
          await publishStagingItem(target);
        } catch (err) {
          failures.push(
            `${target.title}: ${String((err as Error).message || 'Publish failed')}`
          );
        }
      }
      await reloadTree();
      if (failures.length === 0) {
        success(`Published ${queue.length} item${queue.length === 1 ? '' : 's'}`);
      } else {
        showError(
          `Published ${queue.length - failures.length}/${queue.length}. ${failures[0]}`
        );
      }
    } finally {
      setStagingBusy(false);
      setStagingBusyId(null);
    }
  }, [publishStagingItem, reloadTree, showError, stagingBusy, stagingItems, success]);

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

  const handleAssistantResizeStart = (event: React.MouseEvent) => {
    assistantResizeRef.current = {
      active: true,
      startX: event.clientX,
      startWidth: assistantPanelWidthRef.current,
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
    handleSaveRef.current = handleSave;
  }, [handleSave]);

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

  const createDefaultModel = useCallback(
    async (parentPath: string[]) => {
      const prefix = parentPath.length ? `${parentPath.join('/')}/` : '';
      const existing = new Set(
        modelsData.map((model) => normalizeModelPath(model.path)).filter(Boolean)
      );
      let candidate = normalizeModelPath(`${prefix}NewModel.js`);
      let counter = 2;
      while (existing.has(candidate)) {
        candidate = normalizeModelPath(`${prefix}NewModel${counter}.js`);
        counter += 1;
      }
      try {
        await apiFetch('/api/models', {
          method: 'POST',
          body: {
            path: candidate,
            code: DEFAULT_MODEL_CODE,
            fileExtension: DEFAULT_MODEL_EXTENSION,
          },
        });
        success('Model created');
        await loadTree();
      } catch (err) {
        const message = (err as Error).message || 'Failed to create model';
        showError(message);
      }
    },
    [apiFetch, loadTree, modelsData, showError, success]
  );

  const openCreateModal = (
    scope: PanelScope,
    type: 'file' | 'folder',
    parentPath: string[]
  ) => {
    resetActionFeedback();
    if (scope === 'modules' && parentPath[0] === 'acl') {
      showError('ACL folder is read-only.');
      return;
    }
    if (scope === 'models' && type === 'file') {
      void createDefaultModel(parentPath);
      return;
    }
    setCreateScope(scope);
    setCreateType(type);
    setCreateParentPath(parentPath);
    if (scope === 'shared') {
      if (type === 'file') {
        const ext = sharedProject?.fileExtension || 'jsx';
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
      } else if (scope === 'models') {
        const prefix = parentPath.length ? `${parentPath.join('/')}/` : '';
        setModelForm({
          path: normalizeModelPath(`${prefix}ExampleItem.js`),
          fileExtension: DEFAULT_MODEL_EXTENSION,
          code: DEFAULT_MODEL_CODE,
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
    setModelForm({
      path: 'models/ExampleItem.js',
      fileExtension: DEFAULT_MODEL_EXTENSION,
      code: DEFAULT_MODEL_CODE,
    });
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
          setTreeData(
            buildSharedTree(sharedProject, sharedFiles, nextOverrides, {
              rootLabel: sharedRootLabel,
              sharedKind: sharedMode ?? undefined,
            })
          );
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
        await adminFetch(`${sharedBasePath}/${sharedProjectId}/files`, {
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
      setTreeData(buildExplorerTree(modulesData, uiData, modelsData, nextOverrides, aclConfig));
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

    if (createScope === 'models') {
      const normalizedPath = normalizeModelPath(modelForm.path);
      if (!normalizedPath) {
        showError('Model path is required.');
        return;
      }
      try {
        await apiFetch('/api/models', {
          method: 'POST',
          body: {
            path: normalizedPath,
            code: modelForm.code || DEFAULT_MODEL_CODE,
            fileExtension: DEFAULT_MODEL_EXTENSION,
          },
        });
        success('Model created');
        closeCreateModal();
        await loadTree();
      } catch (err) {
        const message = (err as Error).message || 'Failed to create model';
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
      const detectedDependencies = extractUiDependencies(sourceCode);
      await apiFetch('/api/ui-entities', {
        method: 'POST',
        body: {
          name: uiForm.name,
          version: uiForm.version,
          code: sourceCode,
          codeBlob: compiled,
          dependencies: detectedDependencies,
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
    if (meta.kind === 'acl') {
      showError('ACL files cannot be edited from metadata.');
      return;
    }
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
    } else if (meta.kind === 'model') {
      setEditModelForm({
        path: meta.path,
        fileExtension: meta.fileExtension || DEFAULT_MODEL_EXTENSION,
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
          `${sharedBasePath}/${sharedProject.id}/files/${editMeta.fileId}`,
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

    if (editMeta.kind === 'model') {
      const normalizedPath = normalizeModelPath(editModelForm.path);
      if (!normalizedPath) {
        showError('Model path is required.');
        return;
      }
      try {
        await apiFetch(`/api/models/${editMeta.backendId}`, {
          method: 'PUT',
          body: {
            path: normalizedPath,
            fileExtension: DEFAULT_MODEL_EXTENSION,
          },
        });
        success('Model updated');
        closeEditModal();
        await loadTree();
      } catch (err) {
        const message = (err as Error).message || 'Failed to update model';
        showError(message);
      }
      return;
    }

    if (!editUiForm.name.trim() || !editUiForm.version.trim()) {
      showError('Name and version are required.');
      return;
    }
    if (editMeta?.kind !== 'ui') {
      showError('Selected item is not a UI entity.');
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
    if (renameFolderScope === 'modules' && renameFolderPath[0] === 'acl') {
      showError('ACL folder cannot be renamed.');
      return;
    }
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
              `${sharedBasePath}/${sharedProject.id}/files/${file.id}`,
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
      } else if (renameFolderScope === 'models') {
        const updates = modelsData.filter((model) =>
          pathStartsWith(splitModelPath(model.path || ''), oldPath)
        );
        await Promise.all(
          updates.map((model) => {
            const segments = splitModelPath(model.path || '');
            const remainder = segments.slice(oldPath.length);
            const nextPath = normalizeModelPath([...newPath, ...remainder].join('/'));
            return apiFetch(`/api/models/${model.id}`, {
              method: 'PUT',
              body: { path: nextPath, fileExtension: DEFAULT_MODEL_EXTENSION },
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
        if (meta.kind === 'acl') {
          showError('ACL files cannot be deleted.');
          return;
        }
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
            `${sharedBasePath}/${sharedProject.id}/files/${meta.fileId}`,
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
        } else if (meta.kind === 'model') {
          await apiFetch(`/api/models/${meta.backendId}`, { method: 'DELETE' });
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
                `${sharedBasePath}/${sharedProject.id}/files/${file.id}`,
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
          if (deleteTarget.path[0] === 'acl') {
            showError('ACL folder cannot be deleted.');
            return;
          }
          const removals = modulesData.filter((mod) =>
            pathStartsWith(splitRoutePath(mod.routePath || '/'), deleteTarget.path)
          );
          await Promise.all(
            removals.map((mod) =>
              apiFetch(`/api/modules/${mod.id}`, { method: 'DELETE' })
            )
          );
        } else if (deleteTarget.scope === 'models') {
          const removals = modelsData.filter((model) =>
            pathStartsWith(splitModelPath(model.path || ''), deleteTarget.path)
          );
          await Promise.all(
            removals.map((model) =>
              apiFetch(`/api/models/${model.id}`, { method: 'DELETE' })
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
        const message = 'Create items inside Modules, Models, or UI Entities.';
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
      if (node.id === 'modules-root' || node.id === 'models-root' || node.id === 'ui-root') {
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
                `${sharedBasePath}/${sharedProject.id}/files/${meta.fileId}`,
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
                  `${sharedBasePath}/${sharedProject.id}/files/${file.id}`,
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
        const message = 'Cannot move between sections.';
        showError(message);
        return true;
      }
      if (targetScopeInfo.scope === 'modules' && targetScopeInfo.path[0] === 'acl') {
        showError('ACL folder is read-only.');
        return true;
      }
      if (nodeScopeInfo.scope === 'modules' && nodeScopeInfo.path[0] === 'acl') {
        showError('ACL files cannot be moved.');
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
        if (meta.kind === 'model') {
          const nextPath = normalizeModelPath([...targetScopeInfo.path, node.name].join('/'));
          if (nextPath === normalizeModelPath(meta.path)) return true;
          apiFetch(`/api/models/${meta.backendId}`, {
            method: 'PUT',
            body: { path: nextPath, fileExtension: DEFAULT_MODEL_EXTENSION },
          })
            .then(() => loadTree())
            .catch((err) => {
              const message = (err as Error).message || 'Failed to move model';
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

      if (node.id === 'modules-root' || node.id === 'models-root' || node.id === 'ui-root') return true;

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
          } else if (nodeScopeInfo.scope === 'models') {
            const updates = modelsData.filter((model) =>
              pathStartsWith(splitModelPath(model.path || ''), oldPath)
            );
            await Promise.all(
              updates.map((model) => {
                const segments = splitModelPath(model.path || '');
                const remainder = segments.slice(oldPath.length);
                const nextPath = normalizeModelPath([...newPath, ...remainder].join('/'));
                return apiFetch(`/api/models/${model.id}`, {
                  method: 'PUT',
                  body: { path: nextPath, fileExtension: DEFAULT_MODEL_EXTENSION },
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
      modelsData,
      modulesData,
      savedContents,
      sharedBasePath,
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
    const session = encodeURIComponent(previewSession);
    return `${base}/preview.html?name=${name}&version=${version}&tenantHost=${tenant}&previewSession=${session}&t=${previewNonce}`;
  }, [previewBaseUrl, previewNonce, previewSession, previewTarget, tenantHost]);

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
    if (assistantDiff) {
      return {
        original: `inmemory://assistant-diff/${assistantDiff.id}/original`,
        modified: `inmemory://assistant-diff/${assistantDiff.id}/modified`,
      };
    }
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
  }, [activeFile, assistantDiff, selectedRevision]);

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
  const showDiff = Boolean(selectedRevision || assistantDiff);
  const diffOriginal = assistantDiff
    ? assistantDiff.before
    : selectedRevision
    ? getRevisionContent(selectedRevision)
    : '';
  const mainEditorPath = assistantDiff
    ? `inmemory://assistant-diff/${assistantDiff.id}/current`
    : activeFile
    ? editorModelPath ?? 'inmemory://model/empty-main'
    : 'inmemory://model/empty-main';
  const mainEditorValue = assistantDiff ? assistantDiff.after : activeFile ? activeContent : '';
  const mainEditorLanguage = assistantDiff
    ? assistantDiff.language
    : activeFile
    ? monacoLanguage
    : 'plaintext';
  const sideEditorPath = sideFile
    ? sideEditorModelPath ?? 'inmemory://model/side-empty'
    : 'inmemory://model/side-empty';
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
      activeFile.meta && 'fileExtension' in activeFile.meta
        ? (activeFile.meta.fileExtension as string | undefined) ?? ''
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

  const handleRefreshPreview = useCallback(() => {
    setPreviewNonce((prev) => prev + 1);
  }, []);

  const refreshWorkspace = useCallback(() => {
    reloadTree();
    loadHistory();
  }, [loadHistory, reloadTree]);

  const openAssistantDiffPreview = useCallback(
    (payload: {
      path: string;
      before: string;
      after: string;
      language: string;
    }) => {
      const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setHistorySelectedId(null);
      setAssistantDiff({
        id: `assistant-${seed}`,
        path: payload.path,
        before: payload.before,
        after: payload.after,
        language: payload.language || 'plaintext',
      });
      setEditorView('code');
      success(`Opened diff: ${payload.path}`);
    },
    [success]
  );

  

  return (
    <>
      <Script src="/babel/bable.js" strategy="afterInteractive" />
      <div className="flex h-screen flex-col bg-[#1e1e1e] text-gray-100">
        <EditorHeader
          branding={branding}
          editorView={editorView}
          previewPort={previewPort}
          defaultPreviewPort={DEFAULT_PREVIEW_PORT}
          onPreviewPortChange={setPreviewPort}
          onSwitchToCode={() => setEditorView('code')}
          onSwitchToPreview={handleSwitchToPreview}
          onRefreshPreview={handleRefreshPreview}
        />

        <div className="flex flex-1 min-h-0">
          <EditorSidebar
            leftPanel={leftPanel}
            onSelectPanel={(panel) => {
              setLeftPanel(panel);
              setLeftPanelOpen(true);
            }}
            onTogglePanel={(panel) => {
              if (leftPanelOpen && leftPanel === panel) {
                setLeftPanelOpen(false);
              } else {
                setLeftPanel(panel);
                setLeftPanelOpen(true);
              }
            }}
            assistantOpen={assistantPanelOpen}
            onToggleAssistant={() =>
              setAssistantPanelOpen((prev) => !prev)
            }
            sidebarLabel={sidebarLabel}
            sidebarLabelTone={sidebarLabelTone}
            exitHref={exitHref}
          />

          {leftPanelOpen && (
            <div
              className="relative flex h-full min-w-0 flex-col overflow-hidden border-r border-[#2a2d2e] bg-[#252526] text-gray-100"
              style={{ width: leftPanelWidth }}
            >
              {leftPanel === 'explorer' ? (
                <EditorExplorerPanel
                  treeError={treeError}
                  loadingTree={loadingTree}
                  treeData={treeData}
                  onReload={reloadTree}
                  onOpenFile={handleOpenFile}
                  onCreateNode={handleCreateRequest}
                  onRenameNode={handleRenameRequest}
                  onDeleteNode={handleDeleteRequest}
                  onMoveNode={handleMoveRequest}
                  onMigrateModels={
                    isSharedMode ? undefined : () => runModelMigration()
                  }
                  migrateBusy={modelMigrationBusy}
                />
              ) : leftPanel === 'history' ? (
                <EditorHistoryPanel
                  activeFile={activeFile}
                  historyItems={historyItems}
                  historySelectedId={historySelectedId}
                  historyLoading={historyLoading}
                  historyError={historyError}
                  historyPage={historyPage}
                  historyTotalPages={historyTotalPages}
                  historyListRef={historyListRef}
                  historyRowRef={historyRowRef}
                  onRefresh={loadHistory}
                  onSelectRevision={(revisionId) => {
                    setAssistantDiff(null);
                    setHistorySelectedId(revisionId);
                  }}
                  onRollback={handleRollback}
                  onPrevPage={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                  onNextPage={() =>
                    setHistoryPage((prev) => Math.min(historyTotalPages, prev + 1))
                  }
                  formatTimestamp={formatHistoryTimestamp}
                />
              ) : leftPanel === 'staging' ? (
                <EditorStagingPanel
                  stagingItems={stagingItems}
                  stagingCounts={stagingCounts}
                  stagingPublishableCount={stagingPublishableCount}
                  stagingBusy={stagingBusy}
                  stagingBusyId={stagingBusyId}
                  onPublish={publishTarget}
                  onPublishAll={publishAllStagingTargets}
                  formatTimestamp={formatHistoryTimestamp}
                />
              ) : (
                <EditorSearchPanel
                  searchQuery={searchQuery}
                  onSearchQueryChange={setSearchQuery}
                  searchMatchCase={searchMatchCase}
                  onToggleMatchCase={() => setSearchMatchCase((prev) => !prev)}
                  searchWholeWord={searchWholeWord}
                  onToggleWholeWord={() => setSearchWholeWord((prev) => !prev)}
                  searchUseRegex={searchUseRegex}
                  onToggleUseRegex={() => setSearchUseRegex((prev) => !prev)}
                  searchPattern={searchPattern}
                  searchReplace={searchReplace}
                  onSearchReplaceChange={setSearchReplace}
                  onReplaceSelected={replaceSelectedResult}
                  onReplaceAll={replaceAllResults}
                  searchIncludePattern={searchIncludePattern}
                  onSearchIncludeChange={setSearchIncludePattern}
                  searchIncludeFilter={searchIncludeFilter}
                  searchExcludePattern={searchExcludePattern}
                  onSearchExcludeChange={setSearchExcludePattern}
                  searchExcludeFilter={searchExcludeFilter}
                  searchResults={searchResults}
                  searchSelected={searchSelected}
                  onOpenResult={openSearchResult}
                />
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
            <EditorTabBar
              editorView={editorView}
              leftTabs={leftTabs}
              rightTabs={rightTabs}
              activeFileId={activeFile?.id ?? null}
              sideFileId={sideFile?.id ?? null}
              splitRatio={splitRatio}
              isFileDirty={isFileDirty}
              onSelectTab={(file) => {
                setAssistantDiff(null);
                setActiveFile(file);
              }}
              onSelectSideTab={(file) => {
                setAssistantDiff(null);
                setSideFileId(file.id);
              }}
              onCloseTab={handleCloseFile}
              onTabDragStart={handleTabDragStart}
              onTabDragOver={handleTabDragOver}
              onTabDrop={handleTabDrop}
              onTabDragEnd={handleTabDragEnd}
              onTabBarDrop={handleTabBarDrop}
              onSplitResizeStart={handleSplitResizeStart}
              onTabContextMenu={handleTabContextMenu}
              showExitCompare={Boolean(selectedRevision || assistantDiff)}
              onExitCompare={() => {
                setHistorySelectedId(null);
                setAssistantDiff(null);
              }}
            />

            <EditorWorkspace
              editorView={editorView}
              editorDropTarget={editorDropTarget}
              showDiff={showDiff}
              showSplitEditor={showSplitEditor}
              splitRatio={splitRatio}
              activeFile={activeFile}
              sideFile={sideFile}
              mainEditorLanguage={mainEditorLanguage}
              mainEditorValue={mainEditorValue}
              mainEditorPath={mainEditorPath}
              sideEditorLanguage={sideEditorLanguage}
              sideEditorValue={sideEditorValue}
              sideEditorPath={sideEditorPath}
              diffOriginal={diffOriginal}
              diffModelPaths={diffModelPaths}
              onMainEditorChange={handleEditorChange}
              onSideEditorChange={handleSideEditorChange}
              onMainEditorMount={(editor, monacoInstance) => {
                mainEditorRef.current = editor;
                const command = monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS;
                editor.addCommand(command, () => handleSaveRef.current());
              }}
              onSideEditorMount={(editor, monacoInstance) => {
                sideEditorRef.current = editor;
                const command = monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS;
                editor.addCommand(command, () => handleSaveRef.current());
              }}
              onSplitResizeStart={handleSplitResizeStart}
              onEditorDragOver={handleEditorDragOver}
              onEditorDragLeave={handleEditorDragLeave}
              onEditorDrop={handleEditorDrop}
              previewTarget={previewTarget}
              previewSrc={previewSrc}
              previewFrameRef={previewFrameRef}
              tenantHost={tenantHost}
              isSharedMode={isSharedMode}
              uiCount={uiData.length}
              editorAreaRef={editorAreaRef}
            />
          </main>

          {assistantPanelOpen && (
            <aside
              className="relative flex h-full min-w-0 flex-col overflow-hidden border-l border-[#2a2d2e] bg-[#252526] text-gray-100"
              style={{ width: assistantPanelWidth }}
            >
              <div
                className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-[#2a2d2e]"
                onMouseDown={handleAssistantResizeStart}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize assistant panel"
              />
              <EditorAiPanel
                apiFetch={apiFetch}
                apiStreamFetch={apiStreamFetch}
                tenantHost={tenantHost}
                activeFile={activeFile}
                fileContents={fileContents}
                savedContents={savedContents}
                aclConfig={aclConfig}
                onWorkspaceRefresh={refreshWorkspace}
                onOpenChangeInMainEditor={openAssistantDiffPreview}
              />
            </aside>
          )}
        </div>

        <EditorBottomBar
          activeFile={activeFile}
          activeFileType={activeFileType}
          languageOptions={LANGUAGE_OPTIONS}
          onLanguageChange={handleLanguageChange}
        />
        <EditorTabContextMenu
          menu={tabMenu}
          openFiles={openFiles}
          isFileDirty={isFileDirty}
          rightPaneSet={rightPaneSet}
          onRequestCloseTabs={requestCloseTabs}
          onSaveFile={(file) => {
            void handleSaveFile(file);
          }}
          onSaveAll={() => {
            void handleSaveAll();
          }}
          onToggleSide={handleToggleSide}
          onDismiss={() => setTabMenu(null)}
        />
      </div>
      <EditorModals
        createModalOpen={createModalOpen}
        createType={createType}
        createScope={createScope}
        folderForm={folderForm}
        setFolderForm={setFolderForm}
        moduleForm={moduleForm}
        setModuleForm={setModuleForm}
        modelForm={modelForm}
        setModelForm={setModelForm}
        sharedFileForm={sharedFileForm}
        setSharedFileForm={setSharedFileForm}
        uiForm={uiForm}
        setUiForm={setUiForm}
        onCloseCreate={closeCreateModal}
        onCreateSubmit={handleCreateSubmit}
        closePromptOpen={closePromptOpen}
        pendingDirtyFiles={pendingDirtyFiles}
        pendingCloseBusy={pendingCloseBusy}
        pendingCloseAction={pendingCloseAction}
        onCancelClosePrompt={handleCancelClosePrompt}
        onDiscardClosePrompt={handleDiscardClosePrompt}
        onSaveClosePrompt={handleSaveClosePrompt}
        editModalOpen={editModalOpen}
        editMeta={editMeta}
        editModuleForm={editModuleForm}
        setEditModuleForm={setEditModuleForm}
        editModelForm={editModelForm}
        setEditModelForm={setEditModelForm}
        editUiForm={editUiForm}
        setEditUiForm={setEditUiForm}
        editSharedPath={editSharedPath}
        setEditSharedPath={setEditSharedPath}
        onCloseEdit={closeEditModal}
        onEditSubmit={handleEditSubmit}
        renameFolderOpen={renameFolderOpen}
        renameFolderName={renameFolderName}
        setRenameFolderName={setRenameFolderName}
        onCloseRename={closeRenameFolderModal}
        onRenameSubmit={handleRenameFolderSubmit}
        deleteModalOpen={deleteModalOpen}
        deleteTarget={deleteTarget}
        onCloseDelete={closeDeleteModal}
        onDeleteSubmit={handleDeleteSubmit}
      />

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
