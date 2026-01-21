import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { Tenant } from '../../entities/Tenant';
import { TenantRequest } from '../../types/RequestContext';

export const ContextMiddleware =
  (dataSource: DataSource) => async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      const headerOverride = (req.headers['x-tenant-host'] as string | undefined)?.toLowerCase().trim();
      const devFallback = process.env.DEV_TENANT_HOST?.toLowerCase().trim();

      let hostname = (req.hostname || '').toLowerCase();
      if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
        hostname = headerOverride || devFallback || hostname;
      }

      if (!hostname) {
        throw new AppError('Hostname required to resolve tenant', 400);
      }

      const tenantRepo = dataSource.getRepository(Tenant);
      const tenant = await tenantRepo.findOne({ where: { hostname } });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      if (tenant.isSuspended) {
        return res.status(403).json({ error: 'Tenant suspended' });
      }

      if (!tenant.resourceConfig) {
        tenant.resourceConfig = { memory: 512, timeout: 5_000 };
      }

      req.tenant = tenant;
      res.locals.tenantStage = tenant.stage;
      next();
    } catch (error) {
      next(error);
    }
  };
