import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { AdapterFactory } from '../../engine/AdapterFactory';
import { SandboxRunner, SandboxRequestContext } from '../../engine/SandboxRunner';
import { ModuleEntity, HttpMethod } from '../../entities/Module';
import { TenantRequest } from '../../types/RequestContext';

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
      const modules = await moduleRepo.find({
        where: { tenant: { id: req.tenant.id }, method: normalizedMethod as HttpMethod },
        order: { routePath: 'ASC' },
      });

      const matchResult = this.findMatchingModule(modules, req.path);
      if (!matchResult) {
        return res.status(404).json({ error: 'Module not found' });
      }

      const { module, params } = matchResult;

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
          stage: req.tenant.stage,
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
    modules: ModuleEntity[],
    path: string,
  ): { module: ModuleEntity; params: Record<string, string> } | null {
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
}
