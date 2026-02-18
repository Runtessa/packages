import type { DeleteTarget } from '@/components/editor/types';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

type Props = {
  open: boolean;
  deleteTarget: DeleteTarget | null;
  onClose: () => void;
  onSubmit: () => void;
};

export function DeleteConfirmModal({
  open,
  deleteTarget,
  onClose,
  onSubmit,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onSubmit}>
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
  );
}
