export type ModuleSnapshot = {
  id: string;
  routePath: string;
  method: string;
  code: string;
  fileExtension?: string | null;
};

export type UiSnapshot = {
  id: string;
  name: string;
  version: string;
  code: string;
  codeBlob: string;
  dependencies: string[];
  fileExtension?: string | null;
};

export type OrmModelSnapshot = {
  id: string;
  path: string;
  code: string;
  fileExtension?: string | null;
  draftVersion?: string | null;
};

export type SharedProjectSnapshot = {
  id: string;
  name: string;
  version: string;
  entryPath: string;
  code: string;
  codeBlob: string;
  dependencies: string[];
  fileExtension?: string | null;
  ownerTeamId?: number;
  editorTeamIds?: number[];
  kind: 'ui' | 'module';
};

export type SharedFileSnapshot = {
  id: string;
  path: string;
  content: string;
  fileExtension?: string | null;
};

export type AssistantChange =
  | {
      kind: 'module';
      action: 'create' | 'update' | 'delete';
      before?: ModuleSnapshot | null;
      after?: ModuleSnapshot | null;
    }
  | {
      kind: 'model';
      action: 'create' | 'update' | 'delete';
      before?: OrmModelSnapshot | null;
      after?: OrmModelSnapshot | null;
    }
  | {
      kind: 'ui';
      action: 'create' | 'update' | 'delete';
      before?: UiSnapshot | null;
      after?: UiSnapshot | null;
    }
  | {
      kind: 'acl';
      action: 'update';
      file: 'permissions' | 'roles' | 'endpoints';
      before: unknown;
      after: unknown;
    }
  | {
      kind: 'shared-project';
      action: 'create' | 'update' | 'delete';
      before?: SharedProjectSnapshot | null;
      after?: SharedProjectSnapshot | null;
    }
  | {
      kind: 'shared-file';
      action: 'create' | 'update' | 'delete';
      projectId: string;
      projectKind: 'ui' | 'module';
      before?: SharedFileSnapshot | null;
      after?: SharedFileSnapshot | null;
    };
