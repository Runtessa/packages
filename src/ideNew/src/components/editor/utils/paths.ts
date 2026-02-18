import type { ExplorerNode } from '@/components/FileExplorer';
import type {
  EditorLanguage,
  ExplorerScope,
  HistoryItem,
  ModuleDto,
  NodeMeta,
  OrmModelDto,
  SharedFileDto,
  SharedProjectDto,
  UIPackageDto,
} from '@/components/editor/types';
import {
  DEFAULT_UI_EXTENSION,
  MODULE_EXTENSION,
  UI_EXTENSION_OPTIONS,
} from '@/components/editor/constants';

export const detectLanguage = (fileName: string): EditorLanguage => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) return 'jsx';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.ts')) return 'javascript';
  if (lower.endsWith('.js')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return 'plaintext';
};

export const sanitizeForFilename = (value: string) =>
  value
    .trim()
    .replace(/^\/+/, '')
    .replace(/[\/\\]+/g, '-')
    .replace(/[:*?<>|"]+/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

export const splitRoutePath = (routePath: string) => {
  const trimmed = routePath.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return [] as string[];
  return trimmed.split('/').filter(Boolean);
};

export const buildRoutePath = (segments: string[]) =>
  segments.length ? `/${segments.join('/')}` : '/';

export const splitUiName = (name: string) =>
  name
    .split(/[\\/]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);

export const buildUiName = (segments: string[]) => segments.join('/');

export const coerceModuleExtension = (value?: string) =>
  value && value.replace(/^\./, '').toLowerCase() === MODULE_EXTENSION
    ? MODULE_EXTENSION
    : MODULE_EXTENSION;

export const coerceUiExtension = (value?: string) => {
  const normalized = value?.replace(/^\./, '').toLowerCase();
  return normalized && UI_EXTENSION_OPTIONS.includes(normalized)
    ? normalized
    : DEFAULT_UI_EXTENSION;
};

export const formatModuleFileName = (mod: ModuleDto) =>
  `${mod.method.toLowerCase()}.module.${coerceModuleExtension(mod.fileExtension)}`;

export const formatUiFileName = (pkg: UIPackageDto) => {
  const nameSegments = splitUiName(pkg.name || 'ui');
  const baseName = nameSegments[nameSegments.length - 1] || 'ui';
  return `${sanitizeForFilename(baseName)}.ui.${coerceUiExtension(pkg.fileExtension)}`;
};

export const getScopeInfo = (pathNodes: ExplorerNode[]) => {
  const moduleIndex = pathNodes.findIndex((node) => node.id === 'modules-root');
  if (moduleIndex >= 0) {
    return {
      scope: 'modules' as ExplorerScope,
      path: pathNodes.slice(moduleIndex + 1).map((node) => node.name),
    };
  }
  const modelIndex = pathNodes.findIndex((node) => node.id === 'models-root');
  if (modelIndex >= 0) {
    return {
      scope: 'models' as ExplorerScope,
      path: pathNodes.slice(modelIndex + 1).map((node) => node.name),
    };
  }
  const uiIndex = pathNodes.findIndex((node) => node.id === 'ui-root');
  if (uiIndex >= 0) {
    return {
      scope: 'ui' as ExplorerScope,
      path: pathNodes.slice(uiIndex + 1).map((node) => node.name),
    };
  }
  return { scope: null as ExplorerScope | null, path: [] as string[] };
};

export const getSharedPathFromNodes = (pathNodes: ExplorerNode[]) =>
  pathNodes.filter((_, index) => index > 0).map((node) => node.name);

export const findPathById = (root: ExplorerNode, nodeId: string): ExplorerNode[] => {
  const stack: { node: ExplorerNode; path: ExplorerNode[] }[] = [{ node: root, path: [] }];
  while (stack.length) {
    const { node, path } = stack.pop()!;
    const nextPath = [...path, node];
    if (node.id === nodeId) return nextPath;
    if (node.type === 'folder' && node.children) {
      node.children.forEach((child) => {
        stack.push({ node: child, path: nextPath });
      });
    }
  }
  return [];
};

export const getSharedNodeId = (fileId: string) => `shared-${fileId}`;

export const normalizeSharedPath = (value: string) =>
  value.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');

export const splitSharedPath = (value: string) => {
  const normalized = normalizeSharedPath(value);
  return normalized ? normalized.split('/').filter(Boolean) : [];
};

export const normalizeModelPath = (value: string) => {
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed) return '';
  const extMatch = trimmed.match(/\.([^.\/]+)$/);
  if (!extMatch) return `${trimmed}.js`;
  const ext = extMatch[1]?.toLowerCase();
  if (ext !== 'js') {
    return trimmed.replace(/\.[^.\/]+$/, '.js');
  }
  return trimmed;
};

export const splitModelPath = (value: string) => {
  const normalized = normalizeModelPath(value);
  return normalized ? normalized.split('/').filter(Boolean) : [];
};

export const extractFileExtension = (fileName: string) => {
  const idx = fileName.lastIndexOf('.');
  if (idx === -1 || idx === fileName.length - 1) return '';
  return fileName.slice(idx + 1);
};

export const formatHistoryTimestamp = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const getRevisionContent = (item: HistoryItem) => {
  if (item.kind === 'ui') {
    return item.code || item.codeBlob || '';
  }
  return item.code || '';
};

export const pathStartsWith = (path: string[], prefix: string[]) => {
  if (prefix.length > path.length) return false;
  return prefix.every((segment, idx) => path[idx] === segment);
};

export const resolveSharedExtension = (path: string, explicit?: string) => {
  const normalized = explicit?.replace(/^\./, '').toLowerCase();
  if (normalized) return normalized;
  const idx = path.lastIndexOf('.');
  if (idx !== -1 && idx < path.length - 1) {
    return path.slice(idx + 1).toLowerCase();
  }
  return 'jsx';
};

export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getFileIdFromUriPath = (path: string): string | null => {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  if (last === 'side') {
    return parts.length >= 2 ? parts[parts.length - 2] : null;
  }
  return last;
};

export type {
  ModuleDto,
  OrmModelDto,
  UIPackageDto,
  SharedProjectDto,
  SharedFileDto,
  NodeMeta,
};
