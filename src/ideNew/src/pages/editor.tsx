import '@/lib/monaco';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/router';
import type * as monaco from 'monaco-editor';
import { ExplorerNode } from '@/components/FileExplorer';
import { useToast } from '@/components/ui/Toast';
import { useSessionToken } from '@/lib/client/session';
import { getSelectedTenantHost } from '@/lib/client/tenant';
import { useEditorApi } from '@/components/editor/hooks/useEditorApi';
import { usePreviewExceptionTelemetry } from '@/components/editor/hooks/usePreviewExceptionTelemetry';
import { useMoveNodeRequest } from '@/components/editor/hooks/useMoveNodeRequest';
import { useEditorSearchData } from '@/components/editor/hooks/useEditorSearchData';
import { useExplorerRequests } from '@/components/editor/hooks/useExplorerRequests';
import { useEditorPublishActions } from '@/components/editor/hooks/useEditorPublishActions';
import { useEditorSaveActions } from '@/components/editor/hooks/useEditorSaveActions';
import { useEditorHistory } from '@/components/editor/hooks/useEditorHistory';
import { useEditorModalActions } from '@/components/editor/hooks/useEditorModalActions';
import { useEditorShortcuts } from '@/components/editor/hooks/useEditorShortcuts';
import { useEditorPreviewActions } from '@/components/editor/hooks/useEditorPreviewActions';
import { useEditorTabDragDrop } from '@/components/editor/hooks/useEditorTabDragDrop';
import { useEditorClosePrompt } from '@/components/editor/hooks/useEditorClosePrompt';
import { useEditorResizeStart } from '@/components/editor/hooks/useEditorResizeStart';
import { useEditorRollback } from '@/components/editor/hooks/useEditorRollback';
import { useEditorFilePresentation } from '@/components/editor/hooks/useEditorFilePresentation';
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
  buildSearchPattern,
  buildSharedContentMap,
  buildSharedTree,
  detectLanguage,
  escapeRegExp,
  findPathById,
  formatHistoryTimestamp,
  getFileIdFromUriPath,
  getRevisionContent,
  normalizeSharedPath,
  replaceAtRange,
} from '@/components/editor/utils';
import type { AssistantDiffPreview } from '@/components/editor/page-types';
import type {
  ActiveFile,
  DeleteTarget,
  EditorLanguage,
  FolderOverride,
  FolderFormState,
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

  const { apiFetch, apiStreamFetch, adminFetch } = useEditorApi({
    coreApiBase: CORE_API_BASE,
    token,
    clearSession: clear,
  });
  usePreviewExceptionTelemetry({
    apiFetch,
    previewFrameRef,
    previewSession,
    previewName: previewTarget?.name,
    previewVersion: previewTarget?.version,
    tenantHost,
    batchDelayMs: PREVIEW_EXCEPTION_BATCH_DELAY_MS,
    dedupeWindowMs: PREVIEW_EXCEPTION_DEDUPE_MS,
    maxQueueSize: PREVIEW_EXCEPTION_MAX_QUEUE,
  });
  const {
    historyItems,
    historyLoading,
    historyError,
    historySelectedId,
    historyPage,
    historyTotalPages,
    historyListRef,
    historyRowRef,
    setHistorySelectedId,
    setHistoryPage,
    loadHistory,
  } = useEditorHistory({
    activeFile,
    apiFetch,
    leftPanel,
    leftPanelOpen,
  });

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
  const { stagingBusy, stagingBusyId, publishTarget, publishAllStagingTargets } =
    useEditorPublishActions({
      apiFetch,
      adminFetch,
      sharedBasePath,
      sharedProjectId: sharedProject?.id ?? null,
      setSharedProject,
      reloadTree,
      showError,
      success,
      stagingItems,
    });

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

  const {
    handleTabDragStart,
    handleTabDragOver,
    handleEditorDragOver,
    handleEditorDragLeave,
    handleTabDrop,
    handleTabDragEnd,
    handleTabBarDrop,
    handleEditorDrop,
  } = useEditorTabDragDrop({
    dragTabIdRef,
    editorAreaRef,
    setEditorDropTarget,
    setOpenFiles,
    moveTabToPane,
  });

  const {
    modelMigrationBusy,
    runModelMigration,
    handleSaveFile,
    handleSaveAll,
    syncSharedPackage,
  } = useEditorSaveActions({
    adminFetch,
    apiFetch,
    sharedBasePath,
    sharedProject,
    setSharedProject,
    sharedFilesRef,
    setSharedFiles,
    savedContentsRef,
    fileContents,
    savedContents,
    setFileContents,
    setSavedContents,
    aclConfig,
    setAclConfig,
    setUiData,
    reloadTree,
    loadHistory: () => loadHistory(),
    activeFile,
    openFiles,
    isFileDirty,
    success,
    showError,
  });

  const {
    handleCancelClosePrompt,
    handleDiscardClosePrompt,
    handleSaveClosePrompt,
    handleCloseFile,
  } = useEditorClosePrompt({
    pendingCloseBusy,
    pendingCloseIds,
    pendingCloseAction,
    pendingDirtyFiles,
    handleSaveFile,
    closeTabsByIds,
    requestCloseTabs,
    setClosePromptOpen,
    setPendingCloseIds,
    setPendingCloseAction,
    setPendingCloseBusy,
  });

  const {
    handleResizeStart,
    handleAssistantResizeStart,
    handleSplitResizeStart,
  } = useEditorResizeStart({
    leftPanelWidthRef,
    resizeRef,
    assistantPanelWidthRef,
    assistantResizeRef,
    splitResizeRef,
  });

  useEditorShortcuts({
    activeFile,
    handleSaveFile,
    handleSaveRef,
    requestReload,
    reloadTree,
    loadHistory,
  });

  const {
    openCreateModal,
    closeCreateModal,
    handleCreateSubmit,
    openEditModal,
    closeEditModal,
    handleEditSubmit,
    openRenameFolderModal,
    closeRenameFolderModal,
    handleRenameFolderSubmit,
    openDeleteModal,
    closeDeleteModal,
    handleDeleteSubmit,
  } = useEditorModalActions({
    apiFetch,
    adminFetch,
    loadTree,
    reloadTree,
    success,
    showError,
    sharedBasePath,
    sharedRootLabel,
    sharedMode,
    sharedProjectId,
    sharedProject,
    sharedFiles,
    sharedFolderOverrides,
    modulesData,
    modelsData,
    uiData,
    folderOverrides,
    aclConfig,
    savedContents,
    createScope,
    createType,
    createParentPath,
    folderForm,
    moduleForm,
    modelForm,
    uiForm,
    sharedFileForm,
    editMeta,
    editSharedPath,
    editModuleForm,
    editModelForm,
    editUiForm,
    renameFolderScope,
    renameFolderPath,
    renameFolderName,
    deleteTarget,
    removeFileEntries,
    syncSharedPackage,
    savedContentsRef,
    sharedFilesRef,
    setCreateModalOpen,
    setCreateScope,
    setCreateType,
    setCreateParentPath,
    setFolderForm,
    setSharedFileForm,
    setModuleForm,
    setModelForm,
    setUiForm,
    setEditModalOpen,
    setEditMeta,
    setEditSharedPath,
    setEditModuleForm,
    setEditModelForm,
    setEditUiForm,
    setRenameFolderOpen,
    setRenameFolderScope,
    setRenameFolderPath,
    setRenameFolderName,
    setDeleteModalOpen,
    setDeleteTarget,
    setSharedFolderOverrides,
    setFolderOverrides,
    setTreeData,
    setSharedProject,
    setSharedFiles,
    setSavedContents,
  });

  const { handleCreateRequest, handleRenameRequest, handleDeleteRequest } =
    useExplorerRequests({
      isSharedMode,
      openCreateModal,
      openEditModal,
      openRenameFolderModal,
      openDeleteModal,
      showError,
    });

  const handleMoveRequest = useMoveNodeRequest({
    isSharedMode,
    treeData,
    sharedProject,
    sharedFiles,
    sharedFolderOverrides,
    sharedBasePath,
    adminFetch,
    apiFetch,
    loadTree,
    reloadTree,
    modulesData,
    modelsData,
    uiData,
    folderOverrides,
    setFolderOverrides,
    setSharedFolderOverrides,
    setSharedProject,
    setSharedFiles,
    sharedFilesRef,
    syncSharedPackage,
    showError,
  });

  const {
    nodeById,
    searchIncludeFilter,
    searchExcludeFilter,
    searchFiles,
    getPersistedContent,
    searchResults,
  } = useEditorSearchData({
    treeData,
    fileContents,
    savedContents,
    searchIncludePattern,
    searchExcludePattern,
    searchQuery,
    searchPattern,
    searchMatchCase,
  });

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

  const { activeFileType } = useEditorFilePresentation({
    activeFile,
    sideFile,
    getPersistedContent,
    savedContents,
    setFileContents,
  });

  const handleRollback = useEditorRollback({
    activeFile,
    apiFetch,
    reloadTree,
    loadHistory,
    success,
    showError,
    setFileContents,
    setSavedContents,
  });

  const {
    handleSwitchToPreview,
    handleRefreshPreview,
    refreshWorkspace,
    openAssistantDiffPreview,
  } = useEditorPreviewActions({
    isSharedMode,
    sharedProject,
    previewTarget,
    uiData,
    loadHistory,
    reloadTree,
    success,
    setEditorView,
    setPreviewTarget,
    setPreviewNonce,
    setHistorySelectedId,
    setAssistantDiff,
  });

  

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
