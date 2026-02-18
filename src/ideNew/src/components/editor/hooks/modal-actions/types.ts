import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  AclConfigDto,
  DeleteTarget,
  FolderFormState,
  FolderOverride,
  ModelFormState,
  ModuleDto,
  ModuleFormState,
  NodeMeta,
  OrmModelDto,
  PanelScope,
  SharedFileDto,
  SharedFileFormState,
  SharedProjectDto,
  UiFormState,
  UIPackageDto,
} from '@/components/editor/types';

export type FetchFn = (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;

export type ModalActionsParams = {
  apiFetch: FetchFn;
  adminFetch: FetchFn;
  loadTree: (folderState?: FolderOverride[]) => Promise<void>;
  reloadTree: () => Promise<void>;
  success: (message: string) => void;
  showError: (message: string) => void;
  sharedBasePath: string;
  sharedRootLabel: string;
  sharedMode: 'module' | 'ui' | null;
  sharedProjectId: string | null;
  sharedProject: SharedProjectDto | null;
  sharedFiles: SharedFileDto[];
  sharedFolderOverrides: string[][];
  modulesData: ModuleDto[];
  modelsData: OrmModelDto[];
  uiData: UIPackageDto[];
  folderOverrides: FolderOverride[];
  aclConfig: AclConfigDto | null;
  savedContents: Record<string, string>;
  createScope: PanelScope | null;
  createType: 'file' | 'folder' | null;
  createParentPath: string[];
  folderForm: FolderFormState;
  moduleForm: ModuleFormState;
  modelForm: ModelFormState;
  uiForm: UiFormState;
  sharedFileForm: SharedFileFormState;
  editMeta: NodeMeta | null;
  editSharedPath: string;
  editModuleForm: ModuleFormState;
  editModelForm: ModelFormState;
  editUiForm: UiFormState;
  renameFolderScope: PanelScope | null;
  renameFolderPath: string[];
  renameFolderName: string;
  deleteTarget: DeleteTarget | null;
  removeFileEntries: (ids: Set<string>) => void;
  syncSharedPackage: (
    project: SharedProjectDto,
    files: SharedFileDto[],
    entryPathOverride?: string,
  ) => Promise<SharedProjectDto>;
  savedContentsRef: MutableRefObject<Record<string, string>>;
  sharedFilesRef: MutableRefObject<SharedFileDto[]>;
  setCreateModalOpen: Dispatch<SetStateAction<boolean>>;
  setCreateScope: Dispatch<SetStateAction<PanelScope | null>>;
  setCreateType: Dispatch<SetStateAction<'file' | 'folder' | null>>;
  setCreateParentPath: Dispatch<SetStateAction<string[]>>;
  setFolderForm: Dispatch<SetStateAction<FolderFormState>>;
  setSharedFileForm: Dispatch<SetStateAction<SharedFileFormState>>;
  setModuleForm: Dispatch<SetStateAction<ModuleFormState>>;
  setModelForm: Dispatch<SetStateAction<ModelFormState>>;
  setUiForm: Dispatch<SetStateAction<UiFormState>>;
  setEditModalOpen: Dispatch<SetStateAction<boolean>>;
  setEditMeta: Dispatch<SetStateAction<NodeMeta | null>>;
  setEditSharedPath: Dispatch<SetStateAction<string>>;
  setEditModuleForm: Dispatch<SetStateAction<ModuleFormState>>;
  setEditModelForm: Dispatch<SetStateAction<ModelFormState>>;
  setEditUiForm: Dispatch<SetStateAction<UiFormState>>;
  setRenameFolderOpen: Dispatch<SetStateAction<boolean>>;
  setRenameFolderScope: Dispatch<SetStateAction<PanelScope | null>>;
  setRenameFolderPath: Dispatch<SetStateAction<string[]>>;
  setRenameFolderName: Dispatch<SetStateAction<string>>;
  setDeleteModalOpen: Dispatch<SetStateAction<boolean>>;
  setDeleteTarget: Dispatch<SetStateAction<DeleteTarget | null>>;
  setSharedFolderOverrides: Dispatch<SetStateAction<string[][]>>;
  setFolderOverrides: Dispatch<SetStateAction<FolderOverride[]>>;
  setTreeData: Dispatch<SetStateAction<any>>;
  setSharedProject: Dispatch<SetStateAction<SharedProjectDto | null>>;
  setSharedFiles: Dispatch<SetStateAction<SharedFileDto[]>>;
  setSavedContents: Dispatch<SetStateAction<Record<string, string>>>;
};

export type ModalActionsShared = {
  resetActionFeedback: () => void;
};
