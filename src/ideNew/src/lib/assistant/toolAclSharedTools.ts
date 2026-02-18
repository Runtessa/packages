import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import {
  Tenant,
  GlobalUIPackage,
  GlobalUIPackageFile,
  GlobalModulePackage,
  GlobalModulePackageFile,
} from '@idp/shared';
import {
  isTailwindPackageName,
  shouldBuildTailwind,
  getTailwindPackageName,
} from '@/lib/tailwindBuilder';
import {
  buildTailwindCssFromFiles,
  upsertGlobalTailwindPackage,
} from '@/lib/shared-tailwind';
import {
  assertToolPermission,
  normalizeUiName,
  normalizeOwnerTeamId,
  normalizeTeamIdList,
  type AssistantToolContext,
} from './toolContext';
import {
  assertNoMockData,
  assertUiCodeIsRuntimeSafe,
} from './codeContracts';
import {
  normalizeSharedPath,
  normalizeSharedProjectVersion,
  normalizeSharedExtension,
} from './fileNormalizers';
import {
  normalizeAclPermissionsValue,
  normalizeAclRolesValue,
  normalizeAclEndpointsValue,
} from './aclNormalization';
import {
  ensureSharedProjectWriteAccess,
  snapshotSharedFile,
  snapshotSharedProject,
} from './workspaceOps';
import { createSharedProjectInternal, updateSharedBundle } from './toolOperations';

export const buildAclSharedTools = (ctx: AssistantToolContext) => {
  const getAclTool = createTool({
    id: 'get_acl_config',
    description: 'Fetch ACL permissions, roles, and endpoints for the tenant.',
    execute: async () => {
      assertToolPermission(ctx, 'ide.acl.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(Tenant);
      const tenant = await repo.findOne({ where: { id: ctx.tenant.id } });
      if (!tenant) throw new Error('Tenant not found');
      return {
        permissions: normalizeAclPermissionsValue(tenant.aclPermissions),
        roles: normalizeAclRolesValue(tenant.aclRoles),
        endpoints: normalizeAclEndpointsValue(tenant.aclEndpoints),
      };
    },
  });

  const updateAclTool = createTool({
    id: 'update_acl_file',
    description: 'Update an ACL JSON file (permissions, roles, or endpoints).',
    inputSchema: z.object({
      file: z.enum(['permissions', 'roles', 'endpoints']),
      content: z.any(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.acl.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(Tenant);
      const tenant = await repo.findOne({ where: { id: ctx.tenant.id } });
      if (!tenant) throw new Error('Tenant not found');
      const before =
        input.file === 'permissions'
          ? normalizeAclPermissionsValue(tenant.aclPermissions)
          : input.file === 'roles'
          ? normalizeAclRolesValue(tenant.aclRoles)
          : normalizeAclEndpointsValue(tenant.aclEndpoints);
      if (input.file === 'permissions') {
        tenant.aclPermissions = normalizeAclPermissionsValue(input.content);
      } else if (input.file === 'roles') {
        tenant.aclRoles = normalizeAclRolesValue(input.content);
      } else {
        tenant.aclEndpoints = normalizeAclEndpointsValue(input.content);
      }
      await repo.save(tenant);
      ctx.changes.push({
        kind: 'acl',
        action: 'update',
        file: input.file,
        before,
        after: input.content,
      });
      return { ok: true };
    },
  });

  const listSharedUiTool = createTool({
    id: 'list_shared_ui_projects',
    description: 'List shared UI projects (admin only).',
    execute: async () => {
      assertToolPermission(ctx, 'ide.shared_ui.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(GlobalUIPackage);
      const projects = await repo.find({ order: { name: 'ASC', version: 'DESC' } });
      return projects.map((pkg) => snapshotSharedProject(pkg, 'ui'));
    },
  });

  const listSharedModuleTool = createTool({
    id: 'list_shared_module_projects',
    description: 'List shared backend projects (admin only).',
    execute: async () => {
      assertToolPermission(ctx, 'ide.shared_modules.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(GlobalModulePackage);
      const projects = await repo.find({ order: { name: 'ASC', version: 'DESC' } });
      return projects.map((pkg) => snapshotSharedProject(pkg, 'module'));
    },
  });

  const getSharedFileTool = createTool({
    id: 'get_shared_file',
    description: 'Fetch a shared project file (admin only).',
    inputSchema: z.object({
      projectId: z.string(),
      fileId: z.string().optional(),
      path: z.string().optional(),
      projectKind: z.enum(['ui', 'module']),
    }),
    execute: async (input) => {
      assertToolPermission(
        ctx,
        input.projectKind === 'ui' ? 'ide.shared_ui.read' : 'ide.shared_modules.read'
      );
      await ensureCoreSchema();
      const repo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackageFile)
          : CoreDataSource.getRepository(GlobalModulePackageFile);
      const where = input.fileId
        ? { id: input.fileId }
        : { project: { id: input.projectId }, path: normalizeSharedPath(input.path) };
      const file = await repo.findOne({ where });
      if (!file) throw new Error('Shared file not found');
      return snapshotSharedFile(file);
    },
  });

  const writeSharedFileTool = createTool({
    id: 'write_shared_file',
    description: 'Create or update a shared project file (admin only).',
    inputSchema: z
      .object({
      projectId: z.string().optional(),
      projectName: z.string().optional(),
      projectVersion: z.string().optional(),
      projectKind: z.enum(['ui', 'module']),
      path: z.string(),
      content: z.string(),
      fileExtension: z.string().optional(),
      dependencies: z.array(z.string()).optional(),
      ownerTeamId: z.number().int().positive().optional(),
      editorTeamIds: z.array(z.number().int().positive()).optional(),
      })
      .refine((value) => Boolean(value.projectId || value.projectName), {
        message: 'projectId or projectName is required',
        path: ['projectId'],
      }),
    execute: async (input) => {
      assertToolPermission(
        ctx,
        input.projectKind === 'ui' ? 'ide.shared_ui.write' : 'ide.shared_modules.write'
      );
      await ensureCoreSchema();
      const projectRepo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackage)
          : CoreDataSource.getRepository(GlobalModulePackage);
      const fileRepo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackageFile)
          : CoreDataSource.getRepository(GlobalModulePackageFile);

      const normalizedPath = normalizeSharedPath(input.path);
      if (input.projectKind === 'ui') {
        assertUiCodeIsRuntimeSafe(input.content);
      } else {
        assertNoMockData(input.content, 'Shared backend code');
      }
      let project =
        input.projectId
          ? await projectRepo.findOne({ where: { id: input.projectId } })
          : null;

      if (!project && input.projectName) {
        const projectName = normalizeUiName(input.projectName);
        const projectVersion = input.projectVersion
          ? normalizeSharedProjectVersion(input.projectVersion)
          : null;
        project = projectVersion
          ? await projectRepo.findOne({
              where: { name: projectName, version: projectVersion } as any,
            })
          : await projectRepo.findOne({
              where: { name: projectName } as any,
              order: { createdAt: 'DESC' as any },
            });
      }

      if (!project) {
        if (!input.projectName) {
          throw new Error('Shared project not found');
        }
        const created = await createSharedProjectInternal(
          ctx,
          {
            kind: input.projectKind,
            name: input.projectName,
            version: normalizeSharedProjectVersion(input.projectVersion),
            entryPath: normalizedPath,
            code: input.content,
            fileExtension: input.fileExtension,
            dependencies: input.dependencies,
            ownerTeamId: normalizeOwnerTeamId(input.ownerTeamId),
            editorTeamIds: normalizeTeamIdList(input.editorTeamIds),
          },
          { skipChangeTrack: true }
        );
        project = created.project;
        ctx.changes.push({
          kind: 'shared-project',
          action: 'create',
          after: snapshotSharedProject(project as any, input.projectKind),
        });
      }

      if (!project) {
        throw new Error('Shared project resolution failed');
      }
      const ensuredProject = project;
      await ensureSharedProjectWriteAccess(ctx, projectRepo as any, ensuredProject as any);
      const projectId = (ensuredProject as any).id as string;
      let file = await fileRepo.findOne({
        where: { project: { id: projectId }, path: normalizedPath },
      });
      const before = file ? snapshotSharedFile(file) : null;
      const nextExt = normalizeSharedExtension(normalizedPath, input.fileExtension);
      if (!file) {
        file = fileRepo.create({
          project: project as any,
          path: normalizedPath,
          content: input.content,
          fileExtension: nextExt,
        });
      } else {
        file.path = normalizedPath;
        file.content = input.content;
        file.fileExtension = nextExt;
      }
      await fileRepo.save(file);

      const files = await fileRepo.find({
        where: { project: { id: projectId } },
        order: { path: 'ASC' },
      });
      await updateSharedBundle(ensuredProject as any, files as any);
      await projectRepo.save(ensuredProject as any);

      if (
        input.projectKind === 'ui' &&
        shouldBuildTailwind((ensuredProject as any).fileExtension) &&
        !isTailwindPackageName((ensuredProject as any).name)
      ) {
        const css = await buildTailwindCssFromFiles(files as any);
        await upsertGlobalTailwindPackage(
          getTailwindPackageName((ensuredProject as any).name),
          (ensuredProject as any).version,
          css
        );
      }

      ctx.changes.push({
        kind: 'shared-file',
        action: before ? 'update' : 'create',
        projectId,
        projectKind: input.projectKind,
        before,
        after: snapshotSharedFile(file),
      });
      return snapshotSharedFile(file);
    },
  });

  const createSharedUiProjectTool = createTool({
    id: 'create_shared_ui_project',
    description: 'Create a shared UI project (admin only).',
    inputSchema: z.object({
      name: z.string(),
      version: z.string().optional(),
      entryPath: z.string().optional(),
      code: z.string().optional(),
      fileExtension: z.string().optional(),
      dependencies: z.array(z.string()).optional(),
      ownerTeamId: z.number().int().positive().optional(),
      editorTeamIds: z.array(z.number().int().positive()).optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.shared_ui.write');
      await ensureCoreSchema();
      const created = await createSharedProjectInternal(ctx, {
        kind: 'ui',
        name: input.name,
        version: normalizeSharedProjectVersion(input.version),
        entryPath: input.entryPath,
        code: input.code,
        fileExtension: input.fileExtension,
        dependencies: input.dependencies,
        ownerTeamId: input.ownerTeamId,
        editorTeamIds: input.editorTeamIds,
      });
      return snapshotSharedProject(created.project as any, 'ui');
    },
  });

  const createSharedModuleProjectTool = createTool({
    id: 'create_shared_module_project',
    description: 'Create a shared backend project (admin only).',
    inputSchema: z.object({
      name: z.string(),
      version: z.string().optional(),
      entryPath: z.string().optional(),
      code: z.string().optional(),
      fileExtension: z.string().optional(),
      dependencies: z.array(z.string()).optional(),
      ownerTeamId: z.number().int().positive().optional(),
      editorTeamIds: z.array(z.number().int().positive()).optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.shared_modules.write');
      await ensureCoreSchema();
      const created = await createSharedProjectInternal(ctx, {
        kind: 'module',
        name: input.name,
        version: normalizeSharedProjectVersion(input.version),
        entryPath: input.entryPath,
        code: input.code,
        fileExtension: input.fileExtension,
        dependencies: input.dependencies,
        ownerTeamId: input.ownerTeamId,
        editorTeamIds: input.editorTeamIds,
      });
      return snapshotSharedProject(created.project as any, 'module');
    },
  });

  const deleteSharedFileTool = createTool({
    id: 'delete_shared_file',
    description: 'Delete a shared project file (admin only).',
    inputSchema: z.object({
      projectId: z.string(),
      projectKind: z.enum(['ui', 'module']),
      fileId: z.string().optional(),
      path: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(
        ctx,
        input.projectKind === 'ui' ? 'ide.shared_ui.write' : 'ide.shared_modules.write'
      );
      await ensureCoreSchema();
      const projectRepo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackage)
          : CoreDataSource.getRepository(GlobalModulePackage);
      const fileRepo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackageFile)
          : CoreDataSource.getRepository(GlobalModulePackageFile);
      const project = await projectRepo.findOne({ where: { id: input.projectId } });
      if (!project) throw new Error('Shared project not found');
      await ensureSharedProjectWriteAccess(ctx, projectRepo as any, project as any);
      const where = input.fileId
        ? { id: input.fileId }
        : { project: { id: input.projectId }, path: normalizeSharedPath(input.path) };
      const file = await fileRepo.findOne({ where });
      if (!file) throw new Error('Shared file not found');
      const before = snapshotSharedFile(file);
      await fileRepo.remove(file);
      const files = await fileRepo.find({
        where: { project: { id: input.projectId } },
        order: { path: 'ASC' },
      });
      await updateSharedBundle(project as any, files as any);
      await projectRepo.save(project as any);
      if (
        input.projectKind === 'ui' &&
        shouldBuildTailwind(project.fileExtension) &&
        !isTailwindPackageName(project.name)
      ) {
        const css = await buildTailwindCssFromFiles(files as any);
        await upsertGlobalTailwindPackage(
          getTailwindPackageName(project.name),
          project.version,
          css
        );
      }
      ctx.changes.push({
        kind: 'shared-file',
        action: 'delete',
        projectId: input.projectId,
        projectKind: input.projectKind,
        before,
      });
      return { ok: true };
    },
  });

  return {
    get_acl_config: getAclTool,
    update_acl_file: updateAclTool,
    list_shared_ui_projects: listSharedUiTool,
    list_shared_module_projects: listSharedModuleTool,
    create_shared_ui_project: createSharedUiProjectTool,
    create_shared_module_project: createSharedModuleProjectTool,
    get_shared_file: getSharedFileTool,
    write_shared_file: writeSharedFileTool,
    delete_shared_file: deleteSharedFileTool,
  };
};
