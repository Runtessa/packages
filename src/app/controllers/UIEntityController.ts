import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { UIPackage } from '../../entities/UIEntities';
import { TenantRequest } from '../../types/RequestContext';

export class UIEntityController {
  constructor(private readonly dataSource: DataSource) {}

  list = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      this.ensureTenant(req);
      const repo = this.dataSource.getRepository(UIPackage);
      const packages = await repo.find({
        where: { tenant: { id: req.tenant!.id } },
        order: { name: 'ASC', version: 'DESC' },
      });
      return res.json(packages.map(this.serialize));
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      this.ensureTenant(req);
      const repo = this.dataSource.getRepository(UIPackage);
      const pkg = await repo.findOne({
        where: { id: req.params.id, tenant: { id: req.tenant!.id } },
      });
      if (!pkg) {
        return res.status(404).json({ error: 'UI entity not found' });
      }
      return res.json(this.serialize(pkg));
    } catch (error) {
      next(error);
    }
  };

  create = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      this.ensureTenant(req);
      const { name, version, codeBlob, dependencies } = req.body ?? {};
      const normalizedName = this.normalizeName(name);
      const normalizedVersion = this.normalizeVersion(version);
      const normalizedCode = this.normalizeSourceCode(req.body?.code ?? codeBlob);
      const compiledCode = this.normalizeCompiledCode(req.body?.codeBlob ?? codeBlob ?? normalizedCode);
      const normalizedDeps = this.normalizeDependencies(dependencies);
      const fileExtension = this.normalizeFileExtension(req.body?.fileExtension);

      const repo = this.dataSource.getRepository(UIPackage);
      const existing = await repo.findOne({
        where: {
          tenant: { id: req.tenant!.id },
          name: normalizedName,
          version: normalizedVersion,
        },
      });
      if (existing) {
        return res.status(409).json({ error: 'UI entity already exists with this name/version' });
      }

      const pkg = repo.create({
        name: normalizedName,
        version: normalizedVersion,
        code: normalizedCode,
        codeBlob: compiledCode,
        dependencies: normalizedDeps,
        fileExtension,
        tenant: req.tenant!,
      });
      await repo.save(pkg);
      return res.status(201).json(this.serialize(pkg));
    } catch (error) {
      next(error);
    }
  };

  update = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      this.ensureTenant(req);
      const repo = this.dataSource.getRepository(UIPackage);
      const pkg = await repo.findOne({
        where: { id: req.params.id, tenant: { id: req.tenant!.id } },
      });
      if (!pkg) {
        return res.status(404).json({ error: 'UI entity not found' });
      }

      const nextName = req.body?.name ? this.normalizeName(req.body.name) : pkg.name;
      const nextVersion = req.body?.version ? this.normalizeVersion(req.body.version) : pkg.version;
      const nextSource =
        req.body?.code !== undefined
          ? this.normalizeSourceCode(req.body.code)
          : pkg.code;
      const nextCompiled =
        req.body?.codeBlob !== undefined
          ? this.normalizeCompiledCode(req.body.codeBlob)
          : pkg.codeBlob;
      const nextDeps =
        req.body?.dependencies !== undefined
          ? this.normalizeDependencies(req.body.dependencies)
          : pkg.dependencies ?? [];
      const nextExt =
        req.body?.fileExtension !== undefined
          ? this.normalizeFileExtension(req.body.fileExtension)
          : pkg.fileExtension;

      if (nextName !== pkg.name || nextVersion !== pkg.version) {
        const duplicate = await repo.findOne({
          where: {
            tenant: { id: req.tenant!.id },
            name: nextName,
            version: nextVersion,
          },
        });
        if (duplicate && duplicate.id !== pkg.id) {
          return res.status(409).json({ error: 'Another UI entity already uses this name/version' });
        }
      }

      pkg.name = nextName;
      pkg.version = nextVersion;
      pkg.code = nextSource;
      pkg.codeBlob = nextCompiled;
      pkg.dependencies = nextDeps;
      pkg.fileExtension = nextExt;
      await repo.save(pkg);

      return res.json(this.serialize(pkg));
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      this.ensureTenant(req);
      const repo = this.dataSource.getRepository(UIPackage);
      const pkg = await repo.findOne({
        where: { id: req.params.id, tenant: { id: req.tenant!.id } },
      });
      if (!pkg) {
        return res.status(404).json({ error: 'UI entity not found' });
      }
      await repo.remove(pkg);
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

  private normalizeName(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new AppError('name is required', 400);
    }
    return raw.trim();
  }

  private normalizeVersion(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new AppError('version is required', 400);
    }
    return raw.trim();
  }

  private normalizeSourceCode(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new AppError('code is required', 400);
    }
    return raw;
  }

  private normalizeCompiledCode(raw: unknown): string {
    if (typeof raw !== "string" || !raw.trim()) {
      throw new AppError("codeBlob (compiled output) is required", 400);
    }
    return raw;
  }

  private normalizeDependencies(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new AppError('dependencies must be an array', 400);
    }
    return raw.map((item) => String(item));
  }

  private normalizeFileExtension(raw: unknown): string {
    const allowed = new Set(["tsx", "jsx", "ts", "js", "json", "css"]);
    if (!raw || typeof raw !== "string") return "tsx";
    const normalized = raw.replace(/^\./, "").toLowerCase();
    return allowed.has(normalized) ? normalized : "tsx";
  }

  private serialize(pkg: UIPackage) {
    return {
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      code: pkg.code,
      codeBlob: pkg.codeBlob,
      dependencies: pkg.dependencies ?? [],
      fileExtension: pkg.fileExtension,
      createdAt: pkg.createdAt,
      updatedAt: pkg.updatedAt,
    };
  }
}
