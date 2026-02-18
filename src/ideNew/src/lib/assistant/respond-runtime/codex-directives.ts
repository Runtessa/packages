import type { CodexOperation, FileDirective } from './codex-types';
import type { WorkspaceContext } from './workspace-context';
import {
  DEFAULT_UI_CODE,
  normalizeModelPathInput,
  normalizePath,
} from './codex-normalization';

const stripPathSegment = (pathValue: string, segment: string) => {
  const normalized = normalizePath(pathValue);
  if (normalized.toLowerCase().startsWith(`${segment.toLowerCase()}/`)) {
    return normalized.slice(segment.length + 1);
  }
  return normalized;
};

const asJsonObject = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    return null;
  }
  return null;
};

export const buildOperationsFromDirectives = (
  directives: FileDirective[],
  workspace: WorkspaceContext,
): CodexOperation[] => {
  const operations: CodexOperation[] = [];
  const modulesByKey = new Map(
    (workspace.modules ?? []).map((mod) => [
      `${mod.method.toUpperCase()}::${mod.routePath}`,
      mod,
    ]),
  );
  const latestUiByName = new Map<string, WorkspaceContext['uiPackages'][number]>();
  for (const pkg of workspace.uiPackages ?? []) {
    if (!latestUiByName.has(pkg.name)) latestUiByName.set(pkg.name, pkg);
  }
  const sharedUiByName = new Map((workspace.sharedUi ?? []).map((pkg) => [pkg.name, pkg]));
  const sharedModulesByName = new Map(
    (workspace.sharedModules ?? []).map((pkg) => [pkg.name, pkg]),
  );
  const plannedSharedUiCreates = new Set<string>();
  const plannedSharedModuleCreates = new Set<string>();

  for (const directive of directives) {
    const pathValue = normalizePath(directive.path);
    const lower = pathValue.toLowerCase();
    const content = directive.content ?? '';

    if (lower.startsWith('modules/acl/')) {
      const fileMatch = pathValue.match(/^modules\/acl\/(permissions|roles|endpoints)\.json$/i);
      if (!fileMatch || directive.action === 'delete') continue;
      operations.push({
        tool: 'update_acl_file',
        input: {
          file: fileMatch[1].toLowerCase(),
          content: asJsonObject(content) ?? {},
        },
      });
      continue;
    }

    if (lower.startsWith('modules/')) {
      const relative = stripPathSegment(pathValue, 'modules');
      const moduleMatch = relative.match(/^(.*)\/(get|post|put|patch|delete|head|options)\.module\.([a-z0-9]+)$/i);
      if (!moduleMatch) continue;
      const routePart = moduleMatch[1] || '';
      const routePath = routePart ? `/${routePart}` : '/';
      const method = moduleMatch[2].toUpperCase();
      const ext = moduleMatch[3].toLowerCase();
      const existing = modulesByKey.get(`${method}::${routePath}`);
      if (directive.action === 'delete') {
        operations.push({
          tool: 'delete_module',
          input: existing
            ? { id: existing.id }
            : { routePath, method },
        });
        continue;
      }
      operations.push({
        tool: existing || directive.action === 'edit' ? 'update_module' : 'create_module',
        input: existing
          ? { id: existing.id, code: content, fileExtension: ext }
          : { routePath, method, code: content, fileExtension: ext },
      });
      continue;
    }

    if (lower.startsWith('models/')) {
      const rel = stripPathSegment(pathValue, 'models');
      const modelPath = normalizeModelPathInput(`models/${rel}`);
      const extMatch = String(modelPath).match(/\.([a-z0-9]+)$/i);
      const ext = extMatch?.[1]?.toLowerCase() || 'js';
      if (directive.action === 'delete') {
        operations.push({ tool: 'delete_model', input: { path: modelPath } });
      } else if (directive.action === 'edit') {
        operations.push({
          tool: 'update_model',
          input: { path: modelPath, code: content, fileExtension: ext },
        });
      } else {
        operations.push({
          tool: 'create_model',
          input: { path: modelPath, code: content, fileExtension: ext },
        });
      }
      continue;
    }

    if (lower.startsWith('ui/')) {
      const rel = stripPathSegment(pathValue, 'ui');
      const uiMatch = rel.match(/^(.*)\.ui\.([a-z0-9]+)$/i);
      let name = '';
      let ext = '';
      if (uiMatch) {
        name = uiMatch[1];
        ext = uiMatch[2].toLowerCase();
      } else {
        const generic = rel.match(/^(.*)\/([^/.]+)\.([a-z0-9]+)$/i);
        if (!generic) continue;
        ext = generic[3].toLowerCase();
        if (!['jsx', 'js', 'json', 'css'].includes(ext)) continue;
        name =
          generic[2].toLowerCase() === 'index'
            ? generic[1]
            : `${generic[1]}/${generic[2]}`;
      }
      if (!name) continue;
      const existing = latestUiByName.get(name);
      if (directive.action === 'delete') {
        operations.push({
          tool: 'delete_ui_package',
          input: existing
            ? { id: existing.id }
            : { name, version: '1.0.0' },
        });
        continue;
      }
      if (existing) {
        operations.push({
          tool: 'update_ui_package',
          input: { id: existing.id, code: content, fileExtension: ext },
        });
      } else {
        operations.push({
          tool: 'create_ui_package',
          input: { name, version: '1.0.0', code: content, fileExtension: ext },
        });
      }
      continue;
    }

    if (lower.startsWith('shared-ui/')) {
      const rel = stripPathSegment(pathValue, 'shared-ui');
      const parts = rel.split('/');
      const projectName = parts.shift() || '';
      if (!projectName) continue;
      const project = sharedUiByName.get(projectName);
      const filePath = parts.join('/');
      if (!filePath) continue;
      if (!project) {
        if (directive.action === 'delete') continue;
        if (!plannedSharedUiCreates.has(projectName)) {
          operations.push({
            tool: 'create_shared_ui_project',
            input: {
              name: projectName,
              version: '1.0.0',
              entryPath: filePath,
              code: content || DEFAULT_UI_CODE,
              fileExtension: filePath.split('.').pop()?.toLowerCase() || 'jsx',
              dependencies: [],
            },
          });
          plannedSharedUiCreates.add(projectName);
        }
        operations.push({
          tool: 'write_shared_file',
          input: {
            projectName,
            projectVersion: '1.0.0',
            projectKind: 'ui',
            path: filePath,
            content,
          },
        });
        continue;
      }
      operations.push({
        tool: directive.action === 'delete' ? 'delete_shared_file' : 'write_shared_file',
        input:
          directive.action === 'delete'
            ? { projectId: project.id, projectKind: 'ui', path: filePath }
            : {
                projectId: project.id,
                projectKind: 'ui',
                path: filePath,
                content,
              },
      });
      continue;
    }

    if (lower.startsWith('shared-modules/') || lower.startsWith('shared-backend/')) {
      const rel = lower.startsWith('shared-modules/')
        ? stripPathSegment(pathValue, 'shared-modules')
        : stripPathSegment(pathValue, 'shared-backend');
      const parts = rel.split('/');
      const projectName = parts.shift() || '';
      if (!projectName) continue;
      const project = sharedModulesByName.get(projectName);
      const filePath = parts.join('/');
      if (!filePath) continue;
      if (!project) {
        if (directive.action === 'delete') continue;
        if (!plannedSharedModuleCreates.has(projectName)) {
          operations.push({
            tool: 'create_shared_module_project',
            input: {
              name: projectName,
              version: '1.0.0',
              entryPath: filePath,
              code: content || 'module.exports = {};\n',
              fileExtension: filePath.split('.').pop()?.toLowerCase() || 'js',
              dependencies: [],
            },
          });
          plannedSharedModuleCreates.add(projectName);
        }
        operations.push({
          tool: 'write_shared_file',
          input: {
            projectName,
            projectVersion: '1.0.0',
            projectKind: 'module',
            path: filePath,
            content,
          },
        });
        continue;
      }
      operations.push({
        tool: directive.action === 'delete' ? 'delete_shared_file' : 'write_shared_file',
        input:
          directive.action === 'delete'
            ? { projectId: project.id, projectKind: 'module', path: filePath }
            : {
                projectId: project.id,
                projectKind: 'module',
                path: filePath,
                content,
              },
      });
    }
  }

  return operations;
};
