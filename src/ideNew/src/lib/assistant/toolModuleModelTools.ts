import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { HttpMethod, ModuleEntity, OrmModel } from '@idp/shared';
import { generateVersion } from '@/lib/version';
import { compileOrmSource } from '@/lib/orm-compiler';
import {
  assertToolPermission,
  normalizeMethod,
  normalizeRoute,
  normalizeCode,
  type AssistantToolContext,
} from './toolContext';
import {
  assertBackendModuleContract,
  assertOrmModelDecoratorNotation,
} from './codeContracts';
import {
  normalizeModuleExtension,
  normalizeModelPath,
  normalizeModelExtension,
} from './fileNormalizers';
import {
  createModuleRevision,
  ensureAclEndpoint,
  snapshotModel,
  snapshotModule,
} from './workspaceOps';

export const buildModuleModelTools = (ctx: AssistantToolContext) => {
  const getModuleTool = createTool({
    id: 'get_module',
    description: 'Fetch a backend module by id or by route/method.',
    inputSchema: z.object({
      id: z.string().optional(),
      routePath: z.string().optional(),
      method: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.modules.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(ModuleEntity);
      let mod: ModuleEntity | null = null;
      if (input.id) {
        mod = await repo.findOne({
          where: { id: input.id, tenant: { id: ctx.tenant.id } },
        });
      } else if (input.routePath && input.method) {
        mod = await repo.findOne({
          where: {
            tenant: { id: ctx.tenant.id },
            routePath: normalizeRoute(input.routePath),
            method: normalizeMethod(input.method),
          },
        });
      } else if (input.routePath) {
        const routePath = normalizeRoute(input.routePath);
        const candidates = await repo.find({
          where: { tenant: { id: ctx.tenant.id }, routePath },
          order: { method: 'ASC', createdAt: 'DESC' },
        });
        if (candidates.length > 0) {
          mod =
            candidates.find((candidate) => candidate.method === HttpMethod.GET) ??
            candidates[0] ??
            null;
        }
      } else {
        throw new Error('Provide id or routePath (optionally with method)');
      }
      if (!mod) throw new Error('Module not found');
      return snapshotModule(mod);
    },
  });

  const createModuleTool = createTool({
    id: 'create_module',
    description: 'Create a new backend module (route + method + code).',
    inputSchema: z.object({
      routePath: z.string(),
      method: z.string(),
      code: z.string(),
      fileExtension: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.modules.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(ModuleEntity);
      const routePath = normalizeRoute(input.routePath);
      const method = normalizeMethod(input.method);
      const code = normalizeCode(input.code);
      assertBackendModuleContract(code);
      const fileExtension = normalizeModuleExtension(input.fileExtension);
      const existing = await repo.findOne({
        where: { tenant: { id: ctx.tenant.id }, routePath, method },
      });
      if (existing) throw new Error('Module already exists for route/method');
      const mod = repo.create({
        tenant: ctx.tenant,
        routePath,
        method,
        code,
        fileExtension,
        draftVersion: generateVersion(),
      });
      await repo.save(mod);
      await ensureAclEndpoint(ctx.tenant, routePath);
      ctx.changes.push({ kind: 'module', action: 'create', after: snapshotModule(mod) });
      return snapshotModule(mod);
    },
  });

  const updateModuleTool = createTool({
    id: 'update_module',
    description: 'Update an existing backend module by id or by route/method.',
    inputSchema: z.object({
      id: z.string().optional(),
      routePath: z.string().optional(),
      method: z.string().optional(),
      code: z.string().optional(),
      fileExtension: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.modules.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(ModuleEntity);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : {
            tenant: { id: ctx.tenant.id },
            routePath: normalizeRoute(input.routePath),
            method: normalizeMethod(input.method),
          };
      const mod = await repo.findOne({ where });
      if (!mod) throw new Error('Module not found');
      const before = snapshotModule(mod);
      const nextRoute = input.routePath ? normalizeRoute(input.routePath) : mod.routePath;
      const nextMethod = input.method ? normalizeMethod(input.method) : mod.method;
      const nextCode = input.code !== undefined ? normalizeCode(input.code) : mod.code;
      assertBackendModuleContract(nextCode);
      const nextExt =
        input.fileExtension !== undefined
          ? normalizeModuleExtension(input.fileExtension)
          : mod.fileExtension;
      if (nextRoute !== mod.routePath || nextMethod !== mod.method) {
        const duplicate = await repo.findOne({
          where: { tenant: { id: ctx.tenant.id }, routePath: nextRoute, method: nextMethod },
        });
        if (duplicate && duplicate.id !== mod.id) {
          throw new Error('Another module already uses this route/method');
        }
      }
      await createModuleRevision(mod, ctx.tenant, ctx.userId, 'update');
      mod.routePath = nextRoute;
      mod.method = nextMethod;
      mod.code = nextCode;
      mod.fileExtension = nextExt;
      mod.draftVersion = generateVersion();
      await repo.save(mod);
      await ensureAclEndpoint(ctx.tenant, nextRoute);
      ctx.changes.push({
        kind: 'module',
        action: 'update',
        before,
        after: snapshotModule(mod),
      });
      return snapshotModule(mod);
    },
  });

  const deleteModuleTool = createTool({
    id: 'delete_module',
    description: 'Delete a backend module by id or route/method.',
    inputSchema: z.object({
      id: z.string().optional(),
      routePath: z.string().optional(),
      method: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.modules.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(ModuleEntity);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : {
            tenant: { id: ctx.tenant.id },
            routePath: normalizeRoute(input.routePath),
            method: normalizeMethod(input.method),
          };
      const mod = await repo.findOne({ where });
      if (!mod) throw new Error('Module not found');
      const before = snapshotModule(mod);
      await createModuleRevision(mod, ctx.tenant, ctx.userId, 'delete');
      await repo.remove(mod);
      ctx.changes.push({ kind: 'module', action: 'delete', before });
      return { ok: true };
    },
  });

  const listModelsTool = createTool({
    id: 'list_models',
    description: 'List ORM models for the current tenant.',
    execute: async () => {
      assertToolPermission(ctx, 'ide.models.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(OrmModel);
      const models = await repo.find({
        where: { tenant: { id: ctx.tenant.id } },
        order: { path: 'ASC' },
      });
      return models.map(snapshotModel);
    },
  });

  const getModelTool = createTool({
    id: 'get_model',
    description: 'Fetch an ORM model by id or path.',
    inputSchema: z.object({
      id: z.string().optional(),
      path: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.models.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(OrmModel);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : { tenant: { id: ctx.tenant.id }, path: normalizeModelPath(input.path) };
      const model = await repo.findOne({ where });
      if (!model) throw new Error('Model not found');
      return snapshotModel(model);
    },
  });

  const createModelTool = createTool({
    id: 'create_model',
    description: 'Create a new ORM model file for the current tenant.',
    inputSchema: z.object({
      path: z.string(),
      code: z.string(),
      fileExtension: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.models.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(OrmModel);
      const path = normalizeModelPath(input.path);
      const code = normalizeCode(input.code);
      assertOrmModelDecoratorNotation(code);
      const fileExtension = normalizeModelExtension(input.fileExtension);
      const existing = await repo.findOne({
        where: { tenant: { id: ctx.tenant.id }, path },
      });
      if (existing) throw new Error('Model already exists at this path');
      const compiled = compileOrmSource(code, fileExtension);
      const model = repo.create({
        tenant: ctx.tenant,
        path,
        code,
        codeBlob: compiled,
        fileExtension,
        draftVersion: generateVersion(),
      });
      await repo.save(model);
      ctx.changes.push({ kind: 'model', action: 'create', after: snapshotModel(model) });
      return snapshotModel(model);
    },
  });

  const updateModelTool = createTool({
    id: 'update_model',
    description: 'Update an ORM model by id or path.',
    inputSchema: z.object({
      id: z.string().optional(),
      path: z.string().optional(),
      code: z.string().optional(),
      fileExtension: z.string().optional(),
      newPath: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.models.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(OrmModel);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : { tenant: { id: ctx.tenant.id }, path: normalizeModelPath(input.path) };
      const model = await repo.findOne({ where });
      if (!model) throw new Error('Model not found');
      const before = snapshotModel(model);
      const nextPath = input.newPath ? normalizeModelPath(input.newPath) : model.path;
      if (nextPath !== model.path) {
        const duplicate = await repo.findOne({
          where: { tenant: { id: ctx.tenant.id }, path: nextPath },
        });
        if (duplicate && duplicate.id !== model.id) {
          throw new Error('Another model already uses this path');
        }
      }
      const nextCode = input.code !== undefined ? normalizeCode(input.code) : model.code;
      assertOrmModelDecoratorNotation(nextCode);
      const nextExt =
        input.fileExtension !== undefined
          ? normalizeModelExtension(input.fileExtension)
          : model.fileExtension;
      const compiled = compileOrmSource(nextCode, nextExt);
      model.path = nextPath;
      model.code = nextCode;
      model.codeBlob = compiled;
      model.fileExtension = nextExt;
      model.draftVersion = generateVersion();
      await repo.save(model);
      ctx.changes.push({
        kind: 'model',
        action: 'update',
        before,
        after: snapshotModel(model),
      });
      return snapshotModel(model);
    },
  });

  const deleteModelTool = createTool({
    id: 'delete_model',
    description: 'Delete an ORM model by id or path.',
    inputSchema: z.object({
      id: z.string().optional(),
      path: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.models.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(OrmModel);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : { tenant: { id: ctx.tenant.id }, path: normalizeModelPath(input.path) };
      const model = await repo.findOne({ where });
      if (!model) throw new Error('Model not found');
      const before = snapshotModel(model);
      await repo.remove(model);
      ctx.changes.push({ kind: 'model', action: 'delete', before });
      return { ok: true };
    },
  });

  return {
    get_module: getModuleTool,
    create_module: createModuleTool,
    update_module: updateModuleTool,
    delete_module: deleteModuleTool,
    list_models: listModelsTool,
    get_model: getModelTool,
    create_model: createModelTool,
    update_model: updateModelTool,
    delete_model: deleteModelTool,
  };
};
