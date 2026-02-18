import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { ActiveFile } from '@/components/editor/types';

type Props = {
  open: boolean;
  pendingDirtyFiles: ActiveFile[];
  pendingCloseBusy: boolean;
  pendingCloseAction: 'close' | 'reload' | null;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
};

export function ClosePromptModal({
  open,
  pendingDirtyFiles,
  pendingCloseBusy,
  pendingCloseAction,
  onCancel,
  onDiscard,
  onSave,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Unsaved changes"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pendingCloseBusy}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={onDiscard} disabled={pendingCloseBusy}>
            Discard
          </Button>
          <Button variant="primary" onClick={onSave} disabled={pendingCloseBusy}>
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
  );
}
