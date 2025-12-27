import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { UIPackage } from '../../entities/UIEntities';
import { TenantRequest } from '../../types/RequestContext';

export class RegistryController {
  constructor(private readonly dataSource: DataSource) {}

  resolve = async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.tenant) {
        throw new AppError('Tenant required', 400);
      }

      const { name, version } = req.params;
      if (!name) {
        return res.status(400).json({ error: 'Package name required' });
      }

      const pkgRepo = this.dataSource.getRepository(UIPackage);
      let pkg: UIPackage | null = null;

      if (!version || version === 'latest') {
        const latest = await pkgRepo.find({
          where: { tenant: { id: req.tenant.id }, name },
          order: { createdAt: 'DESC' },
          take: 1,
        });
        pkg = latest[0] ?? null;
      } else {
        pkg = await pkgRepo.findOne({
          where: { tenant: { id: req.tenant.id }, name, version },
        });
      }

      if (!pkg) {
        return res.status(404).json({ error: 'Package not found' });
      }

      return res.json({
        name: pkg.name,
        version: pkg.version,
        source: pkg.codeBlob,
        dependencies: pkg.dependencies ?? [],
      });
    } catch (error) {
      next(error);
    }
  };
}
