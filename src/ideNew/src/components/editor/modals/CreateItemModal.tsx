import type { Dispatch, FormEvent, SetStateAction } from 'react';
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
  FolderFormState,
  ModelFormState,
  ModuleFormState,
  PanelScope,
  SharedFileFormState,
  UiFormState,
} from '@/components/editor/types';

type Props = {
  open: boolean;
  createType: 'file' | 'folder' | null;
  createScope: PanelScope | null;
  folderForm: FolderFormState;
  setFolderForm: Dispatch<SetStateAction<FolderFormState>>;
  moduleForm: ModuleFormState;
  setModuleForm: Dispatch<SetStateAction<ModuleFormState>>;
  modelForm: ModelFormState;
  setModelForm: Dispatch<SetStateAction<ModelFormState>>;
  sharedFileForm: SharedFileFormState;
  setSharedFileForm: Dispatch<SetStateAction<SharedFileFormState>>;
  uiForm: UiFormState;
  setUiForm: Dispatch<SetStateAction<UiFormState>>;
  onClose: () => void;
  onSubmit: () => void;
};

const scopeLabel = (scope: PanelScope | null) =>
  scope === 'shared'
    ? 'Shared Project'
    : scope === 'modules'
      ? 'Modules'
      : scope === 'models'
        ? 'Models'
        : 'UI Entities';

const createTitle = (type: 'file' | 'folder' | null, scope: PanelScope | null) => {
  if (type === 'folder') return `Create folder (${scopeLabel(scope)})`;
  if (scope === 'modules') return 'Create module';
  if (scope === 'models') return 'Create model';
  if (scope === 'shared') return 'Create shared file';
  return 'Create UI entity';
};

const handleFormSubmit = (event: FormEvent, onSubmit: () => void) => {
  event.preventDefault();
  onSubmit();
};

export function CreateItemModal({
  open,
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
  onClose,
  onSubmit,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={createTitle(createType, createScope)}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit}>
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
        <form onSubmit={(e) => handleFormSubmit(e, onSubmit)} className="space-y-4">
          <FormLayout gridClassName="grid gap-4 md:grid-cols-2">
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
              options={MODULE_METHOD_OPTIONS.map((method) => ({ label: method, value: method }))}
            />
            <Select
              label="File extension"
              value={moduleForm.fileExtension}
              onChange={(e) => setModuleForm({ ...moduleForm, fileExtension: e.target.value })}
              options={FILE_EXTENSION_OPTIONS.map((ext) => ({ label: ext, value: ext }))}
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
        <form onSubmit={(e) => handleFormSubmit(e, onSubmit)} className="space-y-4">
          <FormLayout>
            <Input
              label="Model path"
              value={modelForm.path}
              onChange={(e) => setModelForm((prev) => ({ ...prev, path: e.target.value }))}
              placeholder="models/ExampleItem.js"
            />
            <Select
              label="File extension"
              value={modelForm.fileExtension}
              onChange={(e) => setModelForm((prev) => ({ ...prev, fileExtension: e.target.value }))}
              options={MODEL_EXTENSION_OPTIONS.map((ext) => ({ label: ext, value: ext }))}
            />
            <TextArea
              label="Model code"
              value={modelForm.code}
              onChange={(e) => setModelForm((prev) => ({ ...prev, code: e.target.value }))}
              rows={8}
            />
          </FormLayout>
        </form>
      ) : createScope === 'shared' ? (
        <form onSubmit={(e) => handleFormSubmit(e, onSubmit)} className="space-y-4">
          <FormLayout>
            <Input
              label="File path"
              value={sharedFileForm.path}
              onChange={(e) => setSharedFileForm((prev) => ({ ...prev, path: e.target.value }))}
              placeholder="src/new-file.jsx"
            />
            <TextArea
              label="Initial content (optional)"
              value={sharedFileForm.content}
              onChange={(e) => setSharedFileForm((prev) => ({ ...prev, content: e.target.value }))}
              rows={6}
            />
          </FormLayout>
        </form>
      ) : (
        <form onSubmit={(e) => handleFormSubmit(e, onSubmit)} className="space-y-4">
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
              options={UI_EXTENSION_OPTIONS.map((ext) => ({ label: ext, value: ext }))}
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
  );
}
