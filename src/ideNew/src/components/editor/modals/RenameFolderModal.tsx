import type { Dispatch, SetStateAction } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { FormLayout } from '@/components/ui/FormLayout';

type Props = {
  open: boolean;
  renameFolderName: string;
  setRenameFolderName: Dispatch<SetStateAction<string>>;
  onClose: () => void;
  onSubmit: () => void;
};

export function RenameFolderModal({
  open,
  renameFolderName,
  setRenameFolderName,
  onClose,
  onSubmit,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename folder"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit}>
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
  );
}
