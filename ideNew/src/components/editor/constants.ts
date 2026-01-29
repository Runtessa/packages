import type { EditorLanguage, SharedFileFormState } from '@/components/editor/types';

export const EDITOR_NAV_ITEMS = [
  { label: 'Editor', href: '/editor', match: '/editor' },
  { label: 'Dashboard', href: '/dashboard', match: '/dashboard' },
  { label: 'Docs', href: '/docs', match: '/docs' },
  { label: 'Shared Projects', href: '/admin/shared-packages', match: '/admin/shared-packages' },
  { label: 'Tenants', href: '/admin/tenants', match: '/admin/tenants' },
];

export const LANGUAGE_OPTIONS: { value: EditorLanguage; label: string }[] = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'jsx', label: 'JSX' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'plaintext', label: 'Plain Text' },
];

export const FOLDER_STORAGE_KEY = 'editor-folder-overrides';
export const SHARED_FOLDER_STORAGE_KEY = 'editor-shared-folder-overrides';

export const MODULE_EXTENSION = 'js';
export const DEFAULT_UI_EXTENSION = 'jsx';
export const UI_EXTENSION_OPTIONS = [DEFAULT_UI_EXTENSION, 'js', 'css'];
export const MODULE_METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const FILE_EXTENSION_OPTIONS = [MODULE_EXTENSION];

export const PREVIEW_PORT_STORAGE_KEY = 'editor-preview-port';
export const DEFAULT_PREVIEW_PORT =
  process.env.NEXT_PUBLIC_KERNEL_PREVIEW_PORT?.trim() || '3000';

export const DEFAULT_MODULE_CODE = `module.exports = async function handler(req, adapters) {
  return {
    statusCode: 200,
    body: { ok: true },
  };
};
`;

export const DEFAULT_UI_CODE = `export default function NewComponent() {
  return <div>New component</div>;
}
`;

export const DEFAULT_CSS_CODE = `/* Add styles for UI entities here */`;

export const DEFAULT_SHARED_FILE: SharedFileFormState = {
  path: '',
  content: '',
};

export const LEFT_PANEL_STORAGE_KEY = 'editor-left-panel-width';
export const MIN_LEFT_PANEL_WIDTH = 150;
export const MAX_LEFT_PANEL_WIDTH = 520;
export const DEFAULT_LEFT_PANEL_WIDTH = 320;

export const SPLIT_RATIO_STORAGE_KEY = 'editor-split-ratio';
export const DEFAULT_SPLIT_RATIO = 0.5;
export const MIN_SPLIT_PX = 240;

export const HISTORY_PAGE_SIZE = 20;
