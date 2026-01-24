import '@/lib/monaco';
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Script from 'next/script';
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

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

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

const CONTENT_STORAGE_KEY = 'editor-file-contents';

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
const UI_EXTENSION = 'jsx';

const coerceModuleExtension = (value?: string) =>
  value && value.replace(/^\./, '').toLowerCase() === MODULE_EXTENSION
    ? MODULE_EXTENSION
    : MODULE_EXTENSION;

const coerceUiExtension = (value?: string) =>
  value && value.replace(/^\./, '').toLowerCase() === UI_EXTENSION
    ? UI_EXTENSION
    : UI_EXTENSION;

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
const UI_EXTENSION_OPTIONS = [UI_EXTENSION];
const FOLDER_STORAGE_KEY = 'editor-folder-overrides';

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

const parseDependencies = (value: string) =>
  value
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

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

export default function EditorPage() {
  const { token, clear, ready } = useSessionToken();
  const { success, error: showError } = useToast();
  const [fileContents, setFileContents] = useState<Record<string, string>>(
    () => {
      if (typeof window === 'undefined') return {};
      const stored = localStorage.getItem(CONTENT_STORAGE_KEY);
      if (!stored) return {};
      try {
        return JSON.parse(stored) as Record<string, string>;
      } catch {
        return {};
      }
    }
  );
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);
  const [openFiles, setOpenFiles] = useState<ActiveFile[]>([]);
  const [treeData, setTreeData] = useState<ExplorerNode | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeError, setTreeError] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [saveError, setSaveError] = useState<string>('');
  const [actionStatus, setActionStatus] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
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
    fileExtension: UI_EXTENSION,
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
    fileExtension: UI_EXTENSION,
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
    if (typeof window === 'undefined') return;
    localStorage.setItem(CONTENT_STORAGE_KEY, JSON.stringify(fileContents));
  }, [fileContents]);

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

  const handleOpenFile = (file: ExplorerNode) => {
    if (file.type !== 'file') return;
    const language = detectLanguage(file.name);
    const meta = (file.meta as NodeMeta | undefined) ?? null;
    const initialContent =
      fileContents[file.id] !== undefined
        ? fileContents[file.id]
        : file.content ?? '';

    setFileContents((prev) => {
      if (prev[file.id] !== undefined) return prev;
      return { ...prev, [file.id]: initialContent };
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

  const handleEditorChange = (value?: string) => {
    if (!activeFile) return;
    setFileContents((prev) => ({
      ...prev,
      [activeFile.id]: value ?? '',
    }));
  };

  const handleLanguageChange = (language: EditorLanguage) => {
    if (!activeFile) return;
    setActiveFile({ ...activeFile, language });
    setOpenFiles((prev) =>
      prev.map((f) => (f.id === activeFile.id ? { ...f, language } : f))
    );
  };

  const handleSave = async () => {
    if (!activeFile || !activeFile.meta) return;
    const content = fileContents[activeFile.id] ?? '';
    setSaving(true);
    setSaveStatus('');
    setSaveError('');
    try {
      if (activeFile.meta.kind === 'module') {
        await apiFetch(`/api/modules/${activeFile.meta.backendId}`, {
          method: 'PUT',
          body: {
            routePath: activeFile.meta.routePath,
            method: activeFile.meta.method,
            code: content,
            fileExtension: coerceModuleExtension(activeFile.meta.fileExtension),
          },
        });
      } else {
        if (!window.Babel) {
          throw new Error('Babel runtime not loaded in browser; cannot build code_blob');
        }
        // Compile source to code_blob using the in-browser Babel runtime (see ideNew/public/babel/bable.js)
        const compiled = compileWithBabel(content);
        await apiFetch(`/api/ui-entities/${activeFile.meta.backendId}`, {
          method: 'PUT',
          body: {
            name: activeFile.meta.name,
            version: activeFile.meta.version,
            code: content,
            codeBlob: compiled,
            dependencies: activeFile.meta.dependencies ?? [],
            fileExtension: coerceUiExtension(activeFile.meta.fileExtension),
          },
        });
      }
      setSaveStatus('Saved');
      loadTree();
    } catch (err) {
      setSaveError((err as Error).message || 'Save failed');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(''), 2000);
    }
  };

  const resetActionFeedback = () => {
    setActionError('');
    setActionStatus('');
  };

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
          fileExtension: UI_EXTENSION,
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
        setActionError('Folder name cannot be empty or contain slashes.');
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
      setActionStatus('Folder created');
      setTimeout(() => setActionStatus(''), 2000);
      closeCreateModal();
      return;
    }

    if (createScope === 'modules') {
      if (!moduleForm.routePath.trim()) {
        setActionError('Route path is required.');
        return;
      }
      if (!moduleForm.method) {
        setActionError('Method is required.');
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
        setActionError(message);
        showError(message);
      }
      return;
    }

    if (!uiForm.name.trim() || !uiForm.version.trim()) {
      setActionError('Name and version are required.');
      return;
    }
    if (!window.Babel) {
      setActionError('Babel runtime not loaded in browser; cannot build code_blob.');
      return;
    }
    try {
      const compiled = compileWithBabel(uiForm.code || DEFAULT_UI_CODE);
      await apiFetch('/api/ui-entities', {
        method: 'POST',
        body: {
          name: uiForm.name,
          version: uiForm.version,
          code: uiForm.code || DEFAULT_UI_CODE,
          codeBlob: compiled,
          dependencies: parseDependencies(uiForm.dependencies),
          fileExtension: UI_EXTENSION,
        },
      });
      success('UI entity created');
      closeCreateModal();
      await loadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to create UI entity';
      setActionError(message);
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
        setActionError('Route path is required.');
        return;
      }
      if (!editModuleForm.method) {
        setActionError('Method is required.');
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
        setActionError(message);
        showError(message);
      }
      return;
    }

    if (!editUiForm.name.trim() || !editUiForm.version.trim()) {
      setActionError('Name and version are required.');
      return;
    }
    try {
      await apiFetch(`/api/ui-entities/${editMeta.backendId}`, {
        method: 'PUT',
        body: {
          name: editUiForm.name,
          version: editUiForm.version,
          dependencies: parseDependencies(editUiForm.dependencies),
          fileExtension: UI_EXTENSION,
        },
      });
      success('UI entity updated');
      closeEditModal();
      await loadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to update UI entity';
      setActionError(message);
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
      setActionError('Folder name cannot be empty or contain slashes.');
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
                fileExtension: UI_EXTENSION,
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
      setActionError(message);
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
      setActionError(message);
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
        setActionError(message);
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
        setActionError(message);
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
              setActionError(message);
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
            fileExtension: UI_EXTENSION,
          },
        })
          .then(() => loadTree())
          .catch((err) => {
            const message = (err as Error).message || 'Failed to move UI entity';
            setActionError(message);
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
                    fileExtension: UI_EXTENSION,
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
          setActionError(message);
          showError(message);
        }
      })();

      return true;
    },
    [apiFetch, folderOverrides, loadTree, modulesData, showError, treeData, uiData]
  );

  const activeContent = activeFile ? fileContents[activeFile.id] ?? '' : '';

  const monacoLanguage = useMemo(() => {
    if (!activeFile) return 'plaintext';
    return activeFile.language === 'jsx' ? 'javascript' : activeFile.language;
  }, [activeFile]);

  return (
    <>
      <Script src="/babel/bable.js" strategy="afterInteractive" />
      <div className="flex h-screen bg-[#1e1e1e] text-gray-100">
        <div className="relative w-80 border-r border-[#2a2d2e]">
          {treeError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-sm text-red-300">
              <p>{treeError}</p>
              <button
                className="rounded bg-[#094771] px-3 py-1 text-white hover:bg-[#0b5b96]"
                onClick={loadTree}
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
          )}
        </div>

        <main className="flex flex-1 flex-col min-w-0">
          <div className="flex items-center gap-2 border-b border-[#2a2d2e] bg-[#252526] px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              {openFiles.map((file) => (
                <button
                  key={file.id}
                  onClick={() => setActiveFile(file)}
                  className={`rounded px-3 py-1 text-sm ${
                    activeFile?.id === file.id
                      ? 'bg-[#094771] text-white'
                      : 'text-gray-200 hover:bg-[#2a2d2e]'
                  }`}
                >
                  {file.name}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-3 text-xs text-gray-300">
              {activeFile?.meta?.kind === 'module' && (
                <div className="flex items-center gap-2">
                  <span className="rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1 text-[11px] uppercase tracking-wide">
                    {activeFile.meta.method}
                  </span>
                  <span className="text-gray-200">{activeFile.meta.routePath}</span>
                </div>
              )}
              {activeFile?.meta?.kind === 'ui' && (
                <div className="flex items-center gap-2">
                  <span className="rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1 text-[11px] uppercase tracking-wide">
                    UI Entity
                  </span>
                  <span className="text-gray-200">
                    {activeFile.meta.name}@{activeFile.meta.version}
                  </span>
                </div>
              )}

              {activeFile && (
                <>
                  <span>Language</span>
                  <select
                    value={
                      LANGUAGE_OPTIONS.some((option) => option.value === activeFile.language)
                        ? activeFile.language
                        : 'javascript'
                    }
                    onChange={(e) => handleLanguageChange(e.target.value as EditorLanguage)}
                    className="rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1 text-sm text-gray-200 focus:border-sky-500 focus:outline-none"
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded bg-[#0b5b96] px-3 py-1 text-white hover:bg-[#0f72be] disabled:opacity-60"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    className="rounded border border-[#3c3c3c] px-3 py-1 text-gray-200 hover:bg-[#2a2d2e]"
                    onClick={loadTree}
                    disabled={loadingTree}
                  >
                    Refresh
                  </button>
                </>
              )}
            </div>
          </div>

          {(saveStatus || saveError) && (
            <div className="flex items-center gap-3 border-b border-[#2a2d2e] bg-[#1f1f1f] px-3 py-2 text-xs">
              {saveStatus && <span className="text-green-300">{saveStatus}</span>}
              {saveError && <span className="text-red-300">{saveError}</span>}
            </div>
          )}

          {(actionStatus || actionError) && (
            <div className="flex items-center gap-3 border-b border-[#2a2d2e] bg-[#1f1f1f] px-3 py-2 text-xs">
              {actionStatus && <span className="text-green-300">{actionStatus}</span>}
              {actionError && <span className="text-red-300">{actionError}</span>}
            </div>
          )}

          <div className="flex flex-1 min-h-0 bg-[#1e1e1e]">
            {activeFile ? (
              <MonacoEditor
                height="100%"
                language={monacoLanguage}
                theme="vs-dark"
                value={activeContent}
                onChange={handleEditorChange}
                options={{
                  fontSize: 14,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                Select a module or UI entity from the explorer to start editing.
              </div>
            )}
          </div>
        </main>
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
                onChange={(e) => setUiForm({ ...uiForm, fileExtension: e.target.value })}
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
    </>
  );
}
