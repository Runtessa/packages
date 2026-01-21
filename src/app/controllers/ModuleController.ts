import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { HttpMethod, ModuleEntity } from '../../entities/Module';
import { TenantRequest } from '../../types/RequestContext';

export class ModuleController {
  constructor(private readonly dataSource: DataSource) {}

  list = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      this.ensureTenant(req);
      const repo = this.dataSource.getRepository(ModuleEntity);
      const modules = await repo.find({
        where: { tenant: { id: req.tenant!.id } },
        order: { routePath: 'ASC', method: 'ASC' },
      });
      return res.json(modules.map(this.serialize));
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      this.ensureTenant(req);
      const repo = this.dataSource.getRepository(ModuleEntity);
      const mod = await repo.findOne({
        where: { id: req.params.id, tenant: { id: req.tenant!.id } },
      });
      if (!mod) {
        return res.status(404).json({ error: 'Module not found' });
      }
      return res.json(this.serialize(mod));
    } catch (error) {
      next(error);
    }
  };

  create = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      this.ensureTenant(req);
      const { routePath, method, code } = req.body ?? {};
      const normalizedRoute = this.normalizeRoute(routePath);
      const normalizedMethod = this.normalizeMethod(method);
      const codeBody = this.normalizeCode(code);
      const fileExtension = this.normalizeFileExtension(req.body?.fileExtension);

      const repo = this.dataSource.getRepository(ModuleEntity);
      const existing = await repo.findOne({
        where: {
          tenant: { id: req.tenant!.id },
          routePath: normalizedRoute,
          method: normalizedMethod,
        },
      });
      if (existing) {
        return res.status(409).json({ error: 'Module already exists for route/method' });
      }

      const mod = repo.create({
        routePath: normalizedRoute,
        method: normalizedMethod,
        code: codeBody,
        fileExtension,
        tenant: req.tenant!,
      });
      await repo.save(mod);
      return res.status(201).json(this.serialize(mod));
    } catch (error) {
      next(error);
    }
  };

  update = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      this.ensureTenant(req);
      const repo = this.dataSource.getRepository(ModuleEntity);
      const mod = await repo.findOne({
        where: { id: req.params.id, tenant: { id: req.tenant!.id } },
      });
      if (!mod) {
        return res.status(404).json({ error: 'Module not found' });
      }

      const nextRoute = req.body?.routePath ? this.normalizeRoute(req.body.routePath) : mod.routePath;
      const nextMethod = req.body?.method ? this.normalizeMethod(req.body.method) : mod.method;
      const nextCode = req.body?.code !== undefined ? this.normalizeCode(req.body.code) : mod.code;
      const nextExt =
        req.body?.fileExtension !== undefined
          ? this.normalizeFileExtension(req.body.fileExtension)
          : mod.fileExtension;

      if (nextRoute !== mod.routePath || nextMethod !== mod.method) {
        const duplicate = await repo.findOne({
          where: {
            tenant: { id: req.tenant!.id },
            routePath: nextRoute,
            method: nextMethod,
          },
        });
        if (duplicate && duplicate.id !== mod.id) {
          return res.status(409).json({ error: 'Another module already uses this route/method' });
        }
      }

      mod.routePath = nextRoute;
      mod.method = nextMethod;
      mod.code = nextCode;
      mod.fileExtension = nextExt;
      await repo.save(mod);

      return res.json(this.serialize(mod));
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      this.ensureTenant(req);
      const repo = this.dataSource.getRepository(ModuleEntity);
      const mod = await repo.findOne({
        where: { id: req.params.id, tenant: { id: req.tenant!.id } },
      });
      if (!mod) {
        return res.status(404).json({ error: 'Module not found' });
      }
      await repo.remove(mod);
      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  private ensureTenant(req: TenantRequest) {
    if (!req.tenant) {
      throw new AppError('Tenant required', 400);
    }
  }

  private normalizeMethod(raw: unknown): HttpMethod {
    if (typeof raw !== 'string') {
      throw new AppError('method is required', 400);
    }
    const upper = raw.toUpperCase();
    if (!Object.values(HttpMethod).includes(upper as HttpMethod)) {
      throw new AppError('Invalid HTTP method', 400);
    }
    return upper as HttpMethod;
  }

  private normalizeRoute(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new AppError('routePath is required', 400);
    }
    const normalized = raw.trim().startsWith('/') ? raw.trim() : `/${raw.trim()}`;
    return normalized;
  }

  private normalizeCode(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new AppError('code is required', 400);
    }
    return raw;
  }

  private normalizeFileExtension(raw: unknown): string {
    const allowed = new Set(["ts", "js", "jsx", "tsx"]);
    if (!raw || typeof raw !== "string") return "ts";
    const normalized = raw.replace(/^\./, "").toLowerCase();
    return allowed.has(normalized) ? normalized : "ts";
  }

  private serialize(mod: ModuleEntity) {
    return {
      id: mod.id,
      routePath: mod.routePath,
      method: mod.method,
      code: mod.code,
      fileExtension: mod.fileExtension,
      createdAt: mod.createdAt,
      updatedAt: mod.updatedAt,
    };
  }
}
