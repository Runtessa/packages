import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SharedProjectDto, StagingItem } from '@/components/editor/types';

type Params = {
  apiFetch: (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;
  adminFetch: (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;
  sharedBasePath: string;
  sharedProjectId: string | null;
  setSharedProject: Dispatch<SetStateAction<SharedProjectDto | null>>;
  reloadTree: () => Promise<void>;
  showError: (message: string) => void;
  success: (message: string) => void;
  stagingItems: StagingItem[];
};

export const useEditorPublishActions = ({
  apiFetch,
  adminFetch,
  sharedBasePath,
  sharedProjectId,
  setSharedProject,
  reloadTree,
  showError,
  success,
  stagingItems,
}: Params) => {
  const [stagingBusy, setStagingBusy] = useState(false);
  const [stagingBusyId, setStagingBusyId] = useState<string | null>(null);

  const publishStagingItem = useCallback(
    async (target: StagingItem) => {
      if (target.kind === 'module') {
        if (!target.backendId) {
          throw new Error('Module id is missing.');
        }
        await apiFetch(`/api/modules/${target.backendId}/publish`, { method: 'POST' });
        return 'Module published';
      }
      if (target.kind === 'ui') {
        if (!target.backendId) {
          throw new Error('UI entity id is missing.');
        }
        await apiFetch(`/api/ui-entities/${target.backendId}/publish`, { method: 'POST' });
        return 'UI entity published';
      }
      const projectId = target.projectId || sharedProjectId;
      if (!projectId) {
        throw new Error('Shared project is not loaded.');
      }
      await adminFetch(`${sharedBasePath}/${projectId}/publish`, {
        method: 'POST',
      });
      const refreshed = await adminFetch(`${sharedBasePath}/${projectId}`);
      setSharedProject(refreshed.package ?? refreshed);
      return 'Shared project published';
    },
    [adminFetch, apiFetch, setSharedProject, sharedBasePath, sharedProjectId],
  );

  const publishTarget = useCallback(
    async (target: StagingItem) => {
      if (stagingBusy) return;
      try {
        setStagingBusy(true);
        setStagingBusyId(target.id);
        const message = await publishStagingItem(target);
        await reloadTree();
        success(message);
      } catch (err) {
        showError((err as Error).message || 'Publish failed');
      } finally {
        setStagingBusy(false);
        setStagingBusyId(null);
      }
    },
    [publishStagingItem, reloadTree, showError, stagingBusy, success],
  );

  const publishAllStagingTargets = useCallback(async () => {
    if (stagingBusy) return;
    const queue = stagingItems.filter((item) => !item.dirty);
    if (queue.length === 0) {
      showError('No publishable items. Save dirty files first.');
      return;
    }
    const failures: string[] = [];
    try {
      setStagingBusy(true);
      setStagingBusyId('__all__');
      for (const target of queue) {
        setStagingBusyId(target.id);
        try {
          await publishStagingItem(target);
        } catch (err) {
          failures.push(`${target.title}: ${String((err as Error).message || 'Publish failed')}`);
        }
      }
      await reloadTree();
      if (failures.length === 0) {
        success(`Published ${queue.length} item${queue.length === 1 ? '' : 's'}`);
      } else {
        showError(`Published ${queue.length - failures.length}/${queue.length}. ${failures[0]}`);
      }
    } finally {
      setStagingBusy(false);
      setStagingBusyId(null);
    }
  }, [publishStagingItem, reloadTree, showError, stagingBusy, stagingItems, success]);

  return {
    stagingBusy,
    stagingBusyId,
    publishTarget,
    publishAllStagingTargets,
  };
};
