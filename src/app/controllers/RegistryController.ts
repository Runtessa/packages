import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { GlobalUIPackage } from '../../entities/GlobalUIPackage';
import { UIPackage } from '../../entities/UIEntities';
import { resolveGlobalDataSource } from '../../core/globalDatasource';
import { resolveGlobalPackage } from '../registry/globalPackages';
import { TenantRequest } from '../../types/RequestContext';

export class RegistryController {
  constructor(private readonly dataSource: DataSource) {}

  resolve = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const { name, version } = req.params;
      if (!name) {
        return res.status(400).json({ error: 'Package name required' });
      }

      const globalDataSource = await resolveGlobalDataSource(this.dataSource);
      const globalRepo = globalDataSource.getRepository(GlobalUIPackage);
      const pkgRepo = this.dataSource.getRepository(UIPackage);

      const findGlobalPackage = async () => {
        if (!version || version === 'latest') {
          const latest = await globalRepo.find({
            where: { name },
            order: { createdAt: 'DESC' },
            take: 1,
          });
          return latest[0] ?? null;
        }
        return globalRepo.findOne({ where: { name, version } });
      };

      const findPackage = async (tenantId: string) => {
        if (!version || version === 'latest') {
          const latest = await pkgRepo.find({
            where: { tenant: { id: tenantId }, name },
            order: { createdAt: 'DESC' },
            take: 1,
          });
          return latest[0] ?? null;
        }
        return pkgRepo.findOne({
          where: { tenant: { id: tenantId }, name, version },
        });
      };

      const globalPkg = await findGlobalPackage();
      if (globalPkg) {
        return res.json({
          name: globalPkg.name,
          version: globalPkg.version,
          source: globalPkg.codeBlob,
          dependencies: globalPkg.dependencies ?? [],
          fileExtension: globalPkg.fileExtension,
        });
      }

      const builtinPackage = resolveGlobalPackage(name, version);
      if (builtinPackage) {
        return res.json({
          name: builtinPackage.name,
          version: builtinPackage.version,
          source: builtinPackage.source,
          dependencies: builtinPackage.dependencies ?? [],
          fileExtension: builtinPackage.fileExtension,
        });
      }

      const pkg = req.tenant ? await findPackage(req.tenant.id) : null;

      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      return res.json({
        name: pkg.name,
        version: pkg.version,
        source: pkg.codeBlob,
        dependencies: pkg.dependencies ?? [],
        fileExtension: pkg.fileExtension,
      });
    } catch (error) {
      next(error);
    }
  };
}
