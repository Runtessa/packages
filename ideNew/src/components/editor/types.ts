import type * as monaco from 'monaco-editor';

export type EditorLanguage =
  | 'javascript'
  | 'jsx'
  | 'css'
  | 'html'
  | 'json'
  | 'markdown'
  | 'plaintext';

export type ActiveFile = {
  id: string;
  name: string;
  language: EditorLanguage;
  meta: NodeMeta | null;
};

export type TabContextMenuState = {
  x: number;
  y: number;
  fileId: string;
};

export type SearchMatchRange = monaco.IRange;

export type SearchResult = {
  id: string;
  fileId: string;
  fileName: string;
  line: number;
  column: number;
  preview: string;
  range: SearchMatchRange;
};

export type SearchPattern = {
  source: string;
  isRegex: boolean;
  regex: RegExp | null;
  error: string | null;
};

export type ModuleDto = {
  id: string;
  routePath: string;
  method: string;
  code: string;
  fileExtension?: string;
  draftVersion?: string;
  publishedVersion?: string;
  publishedAt?: string;
};

export type UIPackageDto = {
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

export type OrmModelDto = {
  id: string;
  path: string;
  code: string;
  fileExtension?: string;
  draftVersion?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type SharedProjectDto = {
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

export type SharedFileDto = {
  id: string;
  path: string;
  fileExtension?: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ModuleRevisionDto = {
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

export type UiRevisionDto = {
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

export type HistoryItem =
  | (ModuleRevisionDto & { kind: 'module' })
  | (UiRevisionDto & { kind: 'ui' });

export type StagingItem = {
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

export type PanelScope = 'modules' | 'ui' | 'shared' | 'models';

export type ExplorerScope = 'modules' | 'ui' | 'models';

export type FolderOverride = {
  scope: ExplorerScope;
  path: string[];
};

export type AclConfigDto = {
  permissions: { permissions?: Array<{ key: string; label?: string }> };
  roles: { roles?: Record<string, string[]>; groups?: Record<string, string[]> };
  endpoints: Record<
    string,
    { read?: string[]; write?: string[]; edit?: string[]; delete?: string[]; allowAnonymous?: boolean }
  >;
};

export type ModuleFormState = {
  routePath: string;
  method: string;
  fileExtension: string;
  code: string;
};

export type UiFormState = {
  name: string;
  version: string;
  fileExtension: string;
  dependencies: string;
  code: string;
};

export type ModelFormState = {
  path: string;
  fileExtension: string;
  code: string;
};

export type FolderFormState = {
  name: string;
};

export type SharedFileFormState = {
  path: string;
  content: string;
};

export type NodeMeta =
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
      sharedKind?: 'ui' | 'module';
    }
  | {
      kind: 'model';
      backendId: string;
      path: string;
      fileExtension?: string;
    }
  | {
      kind: 'acl';
      file: 'permissions' | 'roles' | 'endpoints';
    };

export type PreviewTarget = {
  kind: 'ui' | 'shared';
  name: string;
  version: string;
};

export type DeleteTarget =
  | { type: 'file'; scope: PanelScope; meta: NodeMeta; label: string }
  | { type: 'folder'; scope: PanelScope; path: string[]; label: string };
