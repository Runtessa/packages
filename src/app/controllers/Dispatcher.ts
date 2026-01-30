import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { isDeveloperAccess } from '../../common/devAccess';
import { publishedCache } from '../../core/publishedCache';
import { AdapterFactory } from '../../engine/AdapterFactory';
import { SandboxRunner, SandboxRequestContext } from '../../engine/SandboxRunner';
import { AccountRole, ModuleEntity, HttpMethod, Tenant } from '@idp/shared';
import { TenantRequest } from '../../types/RequestContext';

type ModuleLike = {
  routePath: string;
  method: HttpMethod;
  code: string;
  fileExtension?: string;
};

export class Dispatcher {
  constructor(
    private readonly dataSource: DataSource,
    private readonly adapterFactory: AdapterFactory,
    private readonly sandboxRunner: SandboxRunner,
  ) {}

  handle = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.tenant) {
        throw new AppError('Tenant required', 400);
      }

      const normalizedMethod = req.method.toUpperCase();
      if (!Object.values(HttpMethod).includes(normalizedMethod as HttpMethod)) {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const moduleRepo = this.dataSource.getRepository(ModuleEntity);
      const isDev = isDeveloperAccess(req);
      let modules: ModuleLike[] = [];

      if (isDev) {
        modules = await moduleRepo.find({
          where: { tenant: { id: req.tenant.id }, method: normalizedMethod as HttpMethod },
          order: { routePath: 'ASC' },
        });
      } else {
        const cacheKey = this.publishedModulesCacheKey(req.tenant.id, normalizedMethod as HttpMethod);
        const cached = await publishedCache.get<ModuleLike[]>(cacheKey);
        if (cached) {
          modules = cached;
        } else {
          const published = await moduleRepo.find({
            where: { tenant: { id: req.tenant.id } },
            order: { publishedRoutePath: 'ASC', routePath: 'ASC' },
          });
          modules = published
            .filter(
              (mod) =>
                Boolean(mod.publishedCode) &&
                Boolean(mod.publishedVersion) &&
                (mod.publishedMethod ?? mod.method) === (normalizedMethod as HttpMethod)
            )
            .map((mod) => ({
              routePath: mod.publishedRoutePath ?? mod.routePath,
              method: (mod.publishedMethod ?? mod.method) as HttpMethod,
              code: mod.publishedCode ?? '',
              fileExtension: mod.publishedFileExtension ?? mod.fileExtension,
            }));
          await publishedCache.set(cacheKey, modules);
        }
      }

      const matchResult = this.findMatchingModule(modules, req.path);
      if (!matchResult) {
        return res.status(404).json({ error: 'Module not found' });
      }

      const { module, params } = matchResult;

      if (!req.account) {
        throw new AppError('Authentication required', 401);
      }

      const aclAllowed = this.checkEndpointAccess(
        req.tenant as Tenant,
        req.account.role,
        module,
        req.account.groups ?? [],
      );
      if (!aclAllowed) {
        throw new AppError('Access denied', 403);
      }

      const adapters = await this.adapterFactory.build(req.tenant);
      const requestContext: SandboxRequestContext = {
        path: req.path,
        method: normalizedMethod,
        headers: this.normalizeHeaders(req.headers),
        query: { ...(req.query as Record<string, unknown>) },
        body: req.body,
        params,
        tenant: {
          id: req.tenant.id,
          hostname: req.tenant.hostname,
          resourceConfig: req.tenant.resourceConfig ?? { memory: 512, timeout: 5_000 },
        },
        account: req.account
          ? { id: req.account.id, email: req.account.email, role: req.account.role }
          : undefined,
      };

      const sandboxResult = await this.sandboxRunner.run(module.code, {
        request: requestContext,
        adapters,
      });

      res.status(sandboxResult.statusCode ?? 200);
      if (sandboxResult.headers) {
        for (const [key, value] of Object.entries(sandboxResult.headers)) {
          res.setHeader(key, value);
        }
      }
      res.send(sandboxResult.body ?? null);
    } catch (error) {
      next(error);
    }
  };

  private normalizeHeaders(headers: TenantRequest['headers']): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (!value) {
        continue;
      }

      if (Array.isArray(value)) {
        normalized[key] = value.join(',');
      } else {
        normalized[key] = String(value);
      }
    }
    return normalized;
  }

  private findMatchingModule(
    modules: ModuleLike[],
    path: string,
  ): { module: ModuleLike; params: Record<string, string> } | null {
    for (const mod of modules) {
      const params = this.matchPath(mod.routePath, path);
      if (params) {
        return { module: mod, params };
      }
    }
    return null;
  }

  private matchPath(pattern: string, actual: string): Record<string, string> | null {
    const patternParts = pattern.split('/').filter(Boolean);
    const actualParts = actual.split('/').filter(Boolean);

    if (patternParts.length !== actualParts.length) {
      return null;
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i += 1) {
      const pp = patternParts[i];
      const ap = actualParts[i];
      if (pp.startsWith(':')) {
        params[pp.substring(1)] = decodeURIComponent(ap);
      } else if (pp !== ap) {
        return null;
      }
    }
    return params;
  }

  private publishedModulesCacheKey(tenantId: string, method: HttpMethod) {
    return `module:published:${tenantId}:${method}`;
  }

  private checkEndpointAccess(
    tenant: Tenant,
    accountRole: AccountRole | string,
    module: ModuleLike,
    accountGroups: string[],
  ) {
    const action =
      module.method === HttpMethod.GET
        ? 'read'
        : module.method === HttpMethod.POST
        ? 'write'
        : module.method === HttpMethod.PUT || module.method === HttpMethod.PATCH
        ? 'edit'
        : 'delete';

    const endpoints = (tenant.aclEndpoints || {}) as Record<
      string,
      { read?: string[]; write?: string[]; edit?: string[]; delete?: string[] }
    >;
    const rolesConfig = (tenant.aclRoles || {}) as {
      roles?: Record<string, string[]>;
      groups?: Record<string, string[]>;
    };
    const roles = rolesConfig.roles || {};
    const groups = rolesConfig.groups || {};

    const roleKey = String(accountRole || '').toLowerCase();
    const directRoles = [
      roles[roleKey],
      roles[String(accountRole || '')],
    ].filter(Boolean) as string[][];

    const groupRoles = (accountGroups || [])
      .flatMap((group) => [
        groups[String(group || '').toLowerCase()],
        groups[String(group || '')],
      ])
      .filter(Boolean) as string[][];

    const effectiveRoles = new Set<string>();
    for (const roleList of [...directRoles, ...groupRoles]) {
      for (const roleName of roleList) {
        if (roleName) effectiveRoles.add(roleName);
      }
    }

    const endpointConfig = endpoints[module.routePath];
    if (!endpointConfig) return false;
    const requiredPermissions = endpointConfig[action] || [];
    if (!Array.isArray(requiredPermissions) || requiredPermissions.length === 0) return false;

    const permissions = new Set<string>();
    for (const roleName of effectiveRoles) {
      const rolePermissions = roles[roleName] || roles[String(roleName).toLowerCase()] || [];
      for (const perm of rolePermissions) {
        if (perm) permissions.add(perm);
      }
    }

    return requiredPermissions.some((perm) => permissions.has(perm));
  }
}
