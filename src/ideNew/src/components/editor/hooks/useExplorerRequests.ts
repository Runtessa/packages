import { useCallback } from 'react';
import type { ExplorerNode } from '@/components/FileExplorer';
import type { NodeMeta, PanelScope } from '@/components/editor/types';
import { getScopeInfo, getSharedPathFromNodes } from '@/components/editor/utils';

type CreateRequest = {
  type: 'file' | 'folder';
  parentPath: ExplorerNode[];
};

type RenameOrDeleteRequest = {
  node: ExplorerNode;
  parentPath: ExplorerNode[];
};

type Params = {
  isSharedMode: boolean;
  openCreateModal: (scope: PanelScope, type: 'file' | 'folder', parentPath: string[]) => void;
  openEditModal: (meta: NodeMeta) => void;
  openRenameFolderModal: (scope: PanelScope, path: string[]) => void;
  openDeleteModal: (
    target:
      | { type: 'file'; scope: PanelScope; meta: NodeMeta; label: string }
      | { type: 'folder'; scope: PanelScope; path: string[]; label: string },
  ) => void;
  showError: (message: string) => void;
};

export const useExplorerRequests = ({
  isSharedMode,
  openCreateModal,
  openEditModal,
  openRenameFolderModal,
  openDeleteModal,
  showError,
}: Params) => {
  const handleCreateRequest = useCallback(
    ({ type, parentPath }: CreateRequest) => {
      if (isSharedMode) {
        const sharedPath = getSharedPathFromNodes(parentPath);
        openCreateModal('shared', type, sharedPath);
        return true;
      }
      const scopeInfo = getScopeInfo(parentPath);
      if (!scopeInfo.scope) {
        showError('Create items inside Modules, Models, or UI Entities.');
        return true;
      }
      openCreateModal(scopeInfo.scope, type, scopeInfo.path);
      return true;
    },
    [isSharedMode, openCreateModal, showError],
  );

  const handleRenameRequest = useCallback(
    ({ node, parentPath }: RenameOrDeleteRequest) => {
      if (isSharedMode) {
        if (node.id === 'root') return true;
        if (node.type === 'file') {
          const meta = node.meta as NodeMeta | undefined;
          if (!meta) return true;
          openEditModal(meta);
          return true;
        }
        const sharedPath = getSharedPathFromNodes([...parentPath, node]);
        if (sharedPath.length === 0) return true;
        openRenameFolderModal('shared', sharedPath);
        return true;
      }
      const scopeInfo = getScopeInfo([...parentPath, node]);
      if (!scopeInfo.scope) return true;
      if (node.type === 'file') {
        const meta = node.meta as NodeMeta | undefined;
        if (!meta) return true;
        openEditModal(meta);
        return true;
      }
      if (node.id === 'modules-root' || node.id === 'models-root' || node.id === 'ui-root') {
        return true;
      }
      openRenameFolderModal(scopeInfo.scope, scopeInfo.path);
      return true;
    },
    [isSharedMode, openEditModal, openRenameFolderModal],
  );

  const handleDeleteRequest = useCallback(
    ({ node, parentPath }: RenameOrDeleteRequest) => {
      if (isSharedMode) {
        if (node.id === 'root') return true;
        if (node.type === 'file') {
          const meta = node.meta as NodeMeta | undefined;
          if (!meta) return true;
          openDeleteModal({
            type: 'file',
            scope: 'shared',
            meta,
            label: node.name,
          });
          return true;
        }
        const sharedPath = getSharedPathFromNodes([...parentPath, node]);
        if (!sharedPath.length) return true;
        openDeleteModal({
          type: 'folder',
          scope: 'shared',
          path: sharedPath,
          label: node.name,
        });
        return true;
      }
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
    [isSharedMode, openDeleteModal],
  );

  return {
    handleCreateRequest,
    handleRenameRequest,
    handleDeleteRequest,
  };
};
