import type { Dispatch, SetStateAction } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { Button } from '@/components/ui/Button';
import { FormLayout } from '@/components/ui/FormLayout';
import {
  FILE_EXTENSION_OPTIONS,
  MODEL_EXTENSION_OPTIONS,
  MODULE_METHOD_OPTIONS,
  UI_EXTENSION_OPTIONS,
} from '@/components/editor/constants';
import type {
  ModelFormState,
  ModuleFormState,
  NodeMeta,
  UiFormState,
} from '@/components/editor/types';

type Props = {
  open: boolean;
  editMeta: NodeMeta | null;
  editModuleForm: ModuleFormState;
  setEditModuleForm: Dispatch<SetStateAction<ModuleFormState>>;
  editModelForm: ModelFormState;
  setEditModelForm: Dispatch<SetStateAction<ModelFormState>>;
  editUiForm: UiFormState;
  setEditUiForm: Dispatch<SetStateAction<UiFormState>>;
  editSharedPath: string;
  setEditSharedPath: Dispatch<SetStateAction<string>>;
  onClose: () => void;
  onSubmit: () => void;
};

export function EditItemModal({
  open,
  editMeta,
  editModuleForm,
  setEditModuleForm,
  editModelForm,
  setEditModelForm,
  editUiForm,
  setEditUiForm,
  editSharedPath,
  setEditSharedPath,
  onClose,
  onSubmit,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
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
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit}>
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
            onChange={(e) => setEditModuleForm({ ...editModuleForm, routePath: e.target.value })}
            placeholder="/api/example"
          />
          <Select
            label="Method"
            value={editModuleForm.method}
            onChange={(e) => setEditModuleForm({ ...editModuleForm, method: e.target.value })}
            options={MODULE_METHOD_OPTIONS.map((method) => ({ label: method, value: method }))}
          />
          <Select
            label="File extension"
            value={editModuleForm.fileExtension}
            onChange={(e) =>
              setEditModuleForm({ ...editModuleForm, fileExtension: e.target.value })
            }
            options={FILE_EXTENSION_OPTIONS.map((ext) => ({ label: ext, value: ext }))}
          />
        </FormLayout>
      ) : editMeta?.kind === 'model' ? (
        <FormLayout>
          <Input
            label="Model path"
            value={editModelForm.path}
            onChange={(e) => setEditModelForm({ ...editModelForm, path: e.target.value })}
            placeholder="models/ExampleItem.js"
          />
          <Select
            label="File extension"
            value={editModelForm.fileExtension}
            onChange={(e) => setEditModelForm({ ...editModelForm, fileExtension: e.target.value })}
            options={MODEL_EXTENSION_OPTIONS.map((ext) => ({ label: ext, value: ext }))}
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
            onChange={(e) => setEditUiForm({ ...editUiForm, fileExtension: e.target.value })}
            options={UI_EXTENSION_OPTIONS.map((ext) => ({ label: ext, value: ext }))}
          />
          <div className="md:col-span-2">
            <TextArea
              label="Dependencies (comma or newline separated)"
              value={editUiForm.dependencies}
              onChange={(e) => setEditUiForm({ ...editUiForm, dependencies: e.target.value })}
            />
          </div>
        </FormLayout>
      )}
    </Modal>
  );
}
