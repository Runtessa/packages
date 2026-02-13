import type { EditorLanguage, SharedFileFormState } from '@/components/editor/types';

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
export const DEFAULT_MODEL_EXTENSION = 'js';
export const MODEL_EXTENSION_OPTIONS = [DEFAULT_MODEL_EXTENSION];
export const MODULE_METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
export const FILE_EXTENSION_OPTIONS = [MODULE_EXTENSION];

export const PREVIEW_PORT_STORAGE_KEY = 'editor-preview-port';
export const DEFAULT_PREVIEW_PORT =
  process.env.NEXT_PUBLIC_KERNEL_PREVIEW_PORT?.trim() || '3000';

export const DEFAULT_MODULE_CODE = `/** @type {IdpModuleHandler} */
module.exports = async function handler(req, adapters) {
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

export const DEFAULT_MODEL_CODE = `// Usage in a module:
// const orm = await adapters.orm('postgres:pga1');
// const repo = orm.getRepository('ExampleItem');
// const rows = await repo.find();

const { Entity, PrimaryGeneratedColumn, Column } = require('typeorm');

@Entity({ name: 'example_items' })
class ExampleItem {
  @PrimaryGeneratedColumn('uuid')
  id;

  @Column()
  name;

  @Column({ default: false })
  isActive;
}

module.exports = { ExampleItem };
`;

export const DEFAULT_SHARED_FILE: SharedFileFormState = {
  path: '',
  content: '',
};

export const ACL_FOLDER_NAME = 'acl';
export const ACL_FILE_NAMES = {
  permissions: 'permissions.json',
  roles: 'roles.json',
  endpoints: 'endpoints.json',
} as const;

export const DEFAULT_ACL_PERMISSIONS = `{
  "permissions": [
    { "key": "example.read", "label": "Read Example" }
  ]
}
`;

export const DEFAULT_ACL_ROLES = `{
  "roles": {
    "admin": ["example.read"],
    "viewer": ["example.read"]
  },
  "groups": {
    "devs": ["admin"],
    "guests": ["viewer"]
  }
}
`;

export const DEFAULT_ACL_ENDPOINTS = `{
  "/api/example": {
    "allowAnonymous": true,
    "read": ["example.read"]
  }
}
`;

export const LEFT_PANEL_STORAGE_KEY = 'editor-left-panel-width';
export const MIN_LEFT_PANEL_WIDTH = 150;
export const MAX_LEFT_PANEL_WIDTH = 520;
export const DEFAULT_LEFT_PANEL_WIDTH = 320;
export const ASSISTANT_PANEL_OPEN_STORAGE_KEY = 'editor-assistant-panel-open';
export const DEFAULT_ASSISTANT_PANEL_WIDTH = 420;
export const ASSISTANT_PANEL_WIDTH_STORAGE_KEY = 'editor-assistant-panel-width';
export const MIN_ASSISTANT_PANEL_WIDTH = 320;
export const MAX_ASSISTANT_PANEL_WIDTH = 760;

export const SPLIT_RATIO_STORAGE_KEY = 'editor-split-ratio';
export const DEFAULT_SPLIT_RATIO = 0.5;
export const MIN_SPLIT_PX = 240;

export const HISTORY_PAGE_SIZE = 20;
