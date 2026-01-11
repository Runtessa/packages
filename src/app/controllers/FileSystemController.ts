import path from 'path';
import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { ModuleEntity, HttpMethod } from '../../entities/Module';
import { UIPackage } from '../../entities/UIEntities';
import { TenantRequest } from '../../types/RequestContext';

type EntryType = 'FILE' | 'DIR';

interface VfsStat {
  type: EntryType;
  size: number;
  ctime: number;
  mtime: number;
}

export class FileSystemController {
  constructor(private readonly dataSource: DataSource) {}

  stat = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const tenant = this.ensureTenant(req);
      const targetPath = this.normalizePath(req.query.path);

      if (!targetPath) {
        return res.json(this.dirStat());
      }

      if (targetPath === 'backend') {
        return res.json(await this.statBackend(tenant.id, ''));
      }
      if (targetPath.startsWith('backend/')) {
        const relative = targetPath.substring('backend/'.length);
        const stats = await this.statBackend(tenant.id, relative);
        if (!stats) {
          return res.status(404).json({ error: 'Path not found' });
        }
        return res.json(stats);
      }

      if (targetPath === 'frontend') {
        return res.json(await this.statFrontend(tenant.id, ''));
      }
      if (targetPath.startsWith('frontend/')) {
        const relative = targetPath.substring('frontend/'.length);
        const stats = await this.statFrontend(tenant.id, relative);
        if (!stats) {
          return res.status(404).json({ error: 'Path not found' });
        }
        return res.json(stats);
      }

      return res.status(404).json({ error: 'Path not found' });
    } catch (error) {
      next(error);
    }
  };

  read = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const tenant = this.ensureTenant(req);
      const targetPath = this.normalizePath(req.query.path);

      if (!targetPath || targetPath.endsWith('/')) {
        throw new AppError('File path required', 400);
      }

      if (targetPath.startsWith('backend/')) {
        const relative = targetPath.substring('backend/'.length);
        const content = await this.readBackendFile(tenant.id, relative);
        if (content === null) {
          return res.status(404).json({ error: 'File not found' });
        }
        return res.json({ content });
      }

      if (targetPath.startsWith('frontend/')) {
        const relative = targetPath.substring('frontend/'.length);
        const content = await this.readFrontendFile(tenant.id, relative);
        if (content === null) {
          return res.status(404).json({ error: 'File not found' });
        }
        return res.json({ content });
      }

      return res.status(400).json({ error: 'Unsupported path' });
    } catch (error) {
      next(error);
    }
  };

  write = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const tenant = this.ensureTenant(req);
      const { path: rawPath, content } = req.body ?? {};

      if (!rawPath || typeof rawPath !== 'string') {
        throw new AppError('path is required', 400);
      }
      if (typeof content !== 'string') {
        throw new AppError('content must be a string', 400);
      }

      const targetPath = this.normalizePath(rawPath);
      if (targetPath.startsWith('backend/')) {
        const relative = targetPath.substring('backend/'.length);
        await this.writeBackendFile(tenant.id, tenant, relative, content);
        return res.json({ ok: true });
      }

      if (targetPath.startsWith('frontend/')) {
        const relative = targetPath.substring('frontend/'.length);
        await this.writeFrontendFile(tenant.id, tenant, relative, content);
        return res.json({ ok: true });
      }

      throw new AppError('Unsupported path', 400);
    } catch (error) {
      next(error);
    }
  };

  readdir = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const tenant = this.ensureTenant(req);
      const targetPath = this.normalizePath(req.query.path);

      if (!targetPath) {
        return res.json([
          ['backend', 'DIR'],
          ['frontend', 'DIR'],
        ] satisfies [string, EntryType][]);
      }

      if (targetPath === 'backend' || targetPath.startsWith('backend/')) {
        const relative = targetPath === 'backend' ? '' : targetPath.substring('backend/'.length);
        const entries = await this.listBackendEntries(tenant.id, relative);
        if (!entries.length && relative) {
          return res.status(404).json({ error: 'Path not found' });
        }
        return res.json(entries);
      }

      if (targetPath === 'frontend' || targetPath.startsWith('frontend/')) {
        const relative = targetPath === 'frontend' ? '' : targetPath.substring('frontend/'.length);
        const entries = await this.listFrontendEntries(tenant.id, relative);
        if (!entries.length && relative) {
          return res.status(404).json({ error: 'Path not found' });
        }
        return res.json(entries);
      }

      return res.status(404).json({ error: 'Path not found' });
    } catch (error) {
      next(error);
    }
  };

  private ensureTenant(req: TenantRequest) {
    if (!req.tenant) {
      throw new AppError('Tenant required', 400);
    }
    return req.tenant;
  }

  private normalizePath(raw: unknown): string {
    if (raw === undefined || raw === null) {
      return '';
    }
    const value = Array.isArray(raw) ? raw[0] : raw;
    const decoded = decodeURIComponent(String(value));
    const trimmed = decoded.trim();
    if (!trimmed || trimmed === '/') {
      return '';
    }

    const withoutLeading = trimmed.replace(/^\/+/, '');
    const normalized = path.posix.normalize(withoutLeading);
    return normalized === '.' ? '' : normalized;
  }

  private dirStat(reference?: { ctime: number; mtime: number }): VfsStat {
    const now = Date.now();
    return {
      type: 'DIR',
      size: 0,
      ctime: reference?.ctime ?? now,
      mtime: reference?.mtime ?? now,
    };
  }

  private async statBackend(tenantId: string, relative: string): Promise<VfsStat | null> {
    const repo = this.dataSource.getRepository(ModuleEntity);
    const modules = await repo.find({
      where: { tenant: { id: tenantId } },
      select: ['routePath', 'method', 'createdAt', 'updatedAt'],
    });

    if (!relative) {
      return this.dirStat(this.moduleTimes(modules));
    }

    const fileInfo = this.parseBackendFile(relative);
    if (fileInfo) {
      const record = await repo.findOne({
        where: { tenant: { id: tenantId }, routePath: fileInfo.routePath, method: fileInfo.method },
      });
      if (!record) {
        return null;
      }
      return {
        type: 'FILE',
        size: Buffer.byteLength(record.code, 'utf8'),
        ctime: record.createdAt.getTime(),
        mtime: record.updatedAt.getTime(),
      };
    }

    const parentSegments = relative.split('/').filter(Boolean);
    const matches = modules.filter((mod) => this.startsWithSegments(this.routeSegments(mod.routePath), parentSegments));
    if (!matches.length) {
      return null;
    }
    return this.dirStat(this.moduleTimes(matches));
  }

  private async statFrontend(tenantId: string, relative: string): Promise<VfsStat | null> {
    const packages = await this.getLatestPackages(tenantId);

    if (!relative) {
      return this.dirStat(this.packageTimes(Array.from(packages.values())));
    }

    const pkgName = this.packageNameFromPath(relative);
    if (pkgName) {
      const pkg = packages.get(pkgName);
      if (!pkg) {
        return null;
      }
      return {
        type: 'FILE',
        size: Buffer.byteLength(pkg.codeBlob, 'utf8'),
        ctime: pkg.createdAt.getTime(),
        mtime: pkg.updatedAt.getTime(),
      };
    }

    const parentSegments = relative.split('/').filter(Boolean);
    const matches = Array.from(packages.values()).filter((pkg) =>
      this.startsWithSegments(pkg.name.split('/'), parentSegments),
    );
    if (!matches.length) {
      return null;
    }
    return this.dirStat(this.packageTimes(matches));
  }

  private async readBackendFile(tenantId: string, relative: string): Promise<string | null> {
    const parsed = this.parseBackendFile(relative);
    if (!parsed) {
      return null;
    }
    const repo = this.dataSource.getRepository(ModuleEntity);
    const mod = await repo.findOne({
      where: { tenant: { id: tenantId }, routePath: parsed.routePath, method: parsed.method },
    });
    return mod ? mod.code : null;
  }

  private async readFrontendFile(tenantId: string, relative: string): Promise<string | null> {
    const pkgName = this.packageNameFromPath(relative);
    if (!pkgName) {
      return null;
    }
    const packages = await this.getLatestPackages(tenantId);
    const pkg = packages.get(pkgName);
    return pkg ? pkg.codeBlob : null;
  }

  private async writeBackendFile(
    tenantId: string,
    tenant: TenantRequest['tenant'],
    relative: string,
    content: string,
  ): Promise<void> {
    const parsed = this.parseBackendFile(relative);
    if (!parsed) {
      throw new AppError('Invalid backend path. Expected backend/<route>/<METHOD>.js', 400);
    }

    const repo = this.dataSource.getRepository(ModuleEntity);
    let mod = await repo.findOne({
      where: { tenant: { id: tenantId }, routePath: parsed.routePath, method: parsed.method },
      relations: ['tenant'],
    });

    if (!mod) {
      mod = repo.create({
        routePath: parsed.routePath,
        method: parsed.method,
        code: content,
        tenant: tenant!,
      });
    } else {
      mod.code = content;
    }

    await repo.save(mod);
  }

  private async writeFrontendFile(
    tenantId: string,
    tenant: TenantRequest['tenant'],
    relative: string,
    content: string,
  ): Promise<void> {
    const pkgName = this.packageNameFromPath(relative);
    if (!pkgName) {
      throw new AppError('Invalid frontend path. Expected frontend/<package>.jsx', 400);
    }

    const repo = this.dataSource.getRepository(UIPackage);
    const existing = await repo.find({
      where: { tenant: { id: tenantId }, name: pkgName },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    let pkg = existing[0];
    if (!pkg) {
      pkg = repo.create({
        tenant: tenant!,
        name: pkgName,
        version: 'latest',
        codeBlob: content,
        dependencies: [],
      });
    } else {
      pkg.codeBlob = content;
      pkg.version = pkg.version || 'latest';
    }

    await repo.save(pkg);
  }

  private async listBackendEntries(tenantId: string, relative: string): Promise<[string, EntryType][]> {
    const repo = this.dataSource.getRepository(ModuleEntity);
    const modules = await repo.find({
      where: { tenant: { id: tenantId } },
      select: ['routePath', 'method'],
    });
    const parentSegments = relative.split('/').filter(Boolean);
    const entries = new Map<string, EntryType>();

    for (const mod of modules) {
      const segments = this.routeSegments(mod.routePath);
      if (!this.startsWithSegments(segments, parentSegments)) {
        continue;
      }
      if (segments.length === parentSegments.length) {
        entries.set(`${mod.method}.js`, 'FILE');
      } else if (segments.length > parentSegments.length) {
        entries.set(segments[parentSegments.length], 'DIR');
      }
    }

    return Array.from(entries.entries());
  }

  private async listFrontendEntries(tenantId: string, relative: string): Promise<[string, EntryType][]> {
    const packages = await this.getLatestPackages(tenantId);
    const parentSegments = relative.split('/').filter(Boolean);
    const entries = new Map<string, EntryType>();

    for (const pkg of packages.values()) {
      const segments = pkg.name.split('/');
      if (!this.startsWithSegments(segments, parentSegments)) {
        continue;
      }
      if (segments.length === parentSegments.length + 1) {
        entries.set(`${segments[segments.length - 1]}.jsx`, 'FILE');
      } else if (segments.length > parentSegments.length + 1) {
        entries.set(segments[parentSegments.length], 'DIR');
      }
    }

    return Array.from(entries.entries());
  }

  private parseBackendFile(relative: string): { routePath: string; method: HttpMethod } | null {
    const normalized = path.posix.normalize(relative);
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length) {
      return null;
    }
    const fileName = parts[parts.length - 1];
    if (!fileName.toLowerCase().endsWith('.js')) {
      return null;
    }
    const method = fileName.substring(0, fileName.length - 3).toUpperCase();
    if (!Object.values(HttpMethod).includes(method as HttpMethod)) {
      return null;
    }

    const routeSegments = parts.slice(0, -1);
    const routePath = '/' + routeSegments.join('/');
    return { routePath, method: method as HttpMethod };
  }

  private packageNameFromPath(relative: string): string | null {
    const normalized = path.posix.normalize(relative);
    if (!normalized.toLowerCase().endsWith('.jsx')) {
      return null;
    }
    const withoutExt = normalized.slice(0, -4);
    const segments = withoutExt.split('/').filter(Boolean);
    if (!segments.length) {
      return null;
    }
    return segments.join('/');
  }

  private startsWithSegments(full: string[], prefix: string[]): boolean {
    if (prefix.length > full.length) {
      return false;
    }
    return prefix.every((seg, idx) => full[idx] === seg);
  }

  private routeSegments(routePath: string): string[] {
    return routePath.split('/').filter(Boolean);
  }

  private moduleTimes(modules: Pick<ModuleEntity, 'createdAt' | 'updatedAt'>[]): { ctime: number; mtime: number } {
    if (!modules.length) {
      const now = Date.now();
      return { ctime: now, mtime: now };
    }
    let ctime = modules[0].createdAt.getTime();
    let mtime = modules[0].updatedAt.getTime();
    for (const mod of modules) {
      ctime = Math.min(ctime, mod.createdAt.getTime());
      mtime = Math.max(mtime, mod.updatedAt.getTime());
    }
    return { ctime, mtime };
  }

  private packageTimes(packages: Pick<UIPackage, 'createdAt' | 'updatedAt'>[]): { ctime: number; mtime: number } {
    if (!packages.length) {
      const now = Date.now();
      return { ctime: now, mtime: now };
    }
    let ctime = packages[0].createdAt.getTime();
    let mtime = packages[0].updatedAt.getTime();
    for (const pkg of packages) {
      ctime = Math.min(ctime, pkg.createdAt.getTime());
      mtime = Math.max(mtime, pkg.updatedAt.getTime());
    }
    return { ctime, mtime };
  }

  private async getLatestPackages(tenantId: string): Promise<Map<string, UIPackage>> {
    const repo = this.dataSource.getRepository(UIPackage);
    const records = await repo.find({
      where: { tenant: { id: tenantId } },
      order: { createdAt: 'DESC' },
    });
    const latest = new Map<string, UIPackage>();
    for (const pkg of records) {
      if (!latest.has(pkg.name)) {
        latest.set(pkg.name, pkg);
      }
    }
    return latest;
  }
}
