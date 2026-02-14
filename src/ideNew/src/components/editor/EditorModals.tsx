import type React from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import { FormLayout } from '@/components/ui/FormLayout';
import {
  DEFAULT_CSS_CODE,
  DEFAULT_UI_CODE,
  FILE_EXTENSION_OPTIONS,
  MODEL_EXTENSION_OPTIONS,
  MODULE_METHOD_OPTIONS,
  UI_EXTENSION_OPTIONS,
} from '@/components/editor/constants';
import type {
  ActiveFile,
  DeleteTarget,
  FolderFormState,
  ModelFormState,
  ModuleFormState,
  NodeMeta,
  PanelScope,
  SharedFileFormState,
  UiFormState,
} from '@/components/editor/types';

type EditorModalsProps = {
  createModalOpen: boolean;
  createType: 'file' | 'folder' | null;
  createScope: PanelScope | null;
  folderForm: FolderFormState;
  setFolderForm: React.Dispatch<React.SetStateAction<FolderFormState>>;
  moduleForm: ModuleFormState;
  setModuleForm: React.Dispatch<React.SetStateAction<ModuleFormState>>;
  modelForm: ModelFormState;
  setModelForm: React.Dispatch<React.SetStateAction<ModelFormState>>;
  sharedFileForm: SharedFileFormState;
  setSharedFileForm: React.Dispatch<React.SetStateAction<SharedFileFormState>>;
  uiForm: UiFormState;
  setUiForm: React.Dispatch<React.SetStateAction<UiFormState>>;
  onCloseCreate: () => void;
  onCreateSubmit: () => void;
  closePromptOpen: boolean;
  pendingDirtyFiles: ActiveFile[];
  pendingCloseBusy: boolean;
  pendingCloseAction: 'close' | 'reload' | null;
  onCancelClosePrompt: () => void;
  onDiscardClosePrompt: () => void;
  onSaveClosePrompt: () => void;
  editModalOpen: boolean;
  editMeta: NodeMeta | null;
  editModuleForm: ModuleFormState;
  setEditModuleForm: React.Dispatch<React.SetStateAction<ModuleFormState>>;
  editModelForm: ModelFormState;
  setEditModelForm: React.Dispatch<React.SetStateAction<ModelFormState>>;
  editUiForm: UiFormState;
  setEditUiForm: React.Dispatch<React.SetStateAction<UiFormState>>;
  editSharedPath: string;
  setEditSharedPath: React.Dispatch<React.SetStateAction<string>>;
  onCloseEdit: () => void;
  onEditSubmit: () => void;
  renameFolderOpen: boolean;
  renameFolderName: string;
  setRenameFolderName: React.Dispatch<React.SetStateAction<string>>;
  onCloseRename: () => void;
  onRenameSubmit: () => void;
  deleteModalOpen: boolean;
  deleteTarget: DeleteTarget | null;
  onCloseDelete: () => void;
  onDeleteSubmit: () => void;
};

export function EditorModals({
  createModalOpen,
  createType,
  createScope,
  folderForm,
  setFolderForm,
  moduleForm,
  setModuleForm,
  modelForm,
  setModelForm,
  sharedFileForm,
  setSharedFileForm,
  uiForm,
  setUiForm,
  onCloseCreate,
  onCreateSubmit,
  closePromptOpen,
  pendingDirtyFiles,
  pendingCloseBusy,
  pendingCloseAction,
  onCancelClosePrompt,
  onDiscardClosePrompt,
  onSaveClosePrompt,
  editModalOpen,
  editMeta,
  editModuleForm,
  setEditModuleForm,
  editModelForm,
  setEditModelForm,
  editUiForm,
  setEditUiForm,
  editSharedPath,
  setEditSharedPath,
  onCloseEdit,
  onEditSubmit,
  renameFolderOpen,
  renameFolderName,
  setRenameFolderName,
  onCloseRename,
  onRenameSubmit,
  deleteModalOpen,
  deleteTarget,
  onCloseDelete,
  onDeleteSubmit,
}: EditorModalsProps) {
  return (
    <>
      <Modal
        open={createModalOpen}
        onClose={onCloseCreate}
        title={
          createType === 'folder'
            ? `Create folder (${
                createScope === 'shared'
                  ? 'Shared Project'
                  : createScope === 'modules'
                    ? 'Modules'
                    : createScope === 'models'
                      ? 'Models'
                    : 'UI Entities'
              })`
            : createScope === 'modules'
              ? 'Create module'
              : createScope === 'models'
                ? 'Create model'
              : createScope === 'shared'
                ? 'Create shared file'
                : 'Create UI entity'
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCloseCreate}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onCreateSubmit}>
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
              onCreateSubmit();
            }}
            className="space-y-4"
          >
            <FormLayout gridClassName="grid gap-4 md:grid-cols-2">
              <Input
                label="Route path"
                value={moduleForm.routePath}
                onChange={(e) =>
                  setModuleForm({ ...moduleForm, routePath: e.target.value })
                }
                placeholder="/api/example"
              />
              <Select
                label="Method"
                value={moduleForm.method}
                onChange={(e) =>
                  setModuleForm({ ...moduleForm, method: e.target.value })
                }
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
        ) : createScope === 'models' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCreateSubmit();
            }}
            className="space-y-4"
          >
            <FormLayout>
              <Input
                label="Model path"
                value={modelForm.path}
                onChange={(e) =>
                  setModelForm((prev) => ({ ...prev, path: e.target.value }))
                }
                placeholder="models/ExampleItem.js"
              />
              <Select
                label="File extension"
                value={modelForm.fileExtension}
                onChange={(e) =>
                  setModelForm((prev) => ({ ...prev, fileExtension: e.target.value }))
                }
                options={MODEL_EXTENSION_OPTIONS.map((ext) => ({
                  label: ext,
                  value: ext,
                }))}
              />
              <TextArea
                label="Model code"
                value={modelForm.code}
                onChange={(e) =>
                  setModelForm((prev) => ({ ...prev, code: e.target.value }))
                }
                rows={8}
              />
            </FormLayout>
          </form>
        ) : createScope === 'shared' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCreateSubmit();
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
                placeholder="src/new-file.jsx"
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
              onCreateSubmit();
            }}
            className="space-y-4"
          >
            <FormLayout gridClassName="grid gap-4 md:grid-cols-2">
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
        onClose={onCancelClosePrompt}
        title="Unsaved changes"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancelClosePrompt} disabled={pendingCloseBusy}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={onDiscardClosePrompt}
              disabled={pendingCloseBusy}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              onClick={onSaveClosePrompt}
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
        onClose={onCloseEdit}
        title={
          editMeta?.kind === 'module'
            ? 'Edit module'
            : editMeta?.kind === 'model'
              ? 'Edit model'
            : editMeta?.kind === 'shared'
              ? 'Edit shared file'
              : 'Edit UI entity'
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCloseEdit}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onEditSubmit}>
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
        ) : editMeta?.kind === 'model' ? (
          <FormLayout>
            <Input
              label="Model path"
              value={editModelForm.path}
              onChange={(e) =>
                setEditModelForm({ ...editModelForm, path: e.target.value })
              }
              placeholder="models/ExampleItem.js"
            />
            <Select
              label="File extension"
              value={editModelForm.fileExtension}
              onChange={(e) =>
                setEditModelForm({ ...editModelForm, fileExtension: e.target.value })
              }
              options={MODEL_EXTENSION_OPTIONS.map((ext) => ({
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
              placeholder="src/file.jsx"
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
        onClose={onCloseRename}
        title="Rename folder"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCloseRename}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onRenameSubmit}>
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
        onClose={onCloseDelete}
        title="Delete"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCloseDelete}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onDeleteSubmit}>
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
