import { NextFunction, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '../../common/AppError';
import { CryptoService } from '../../core/security/CryptoService';
import { Account } from '../../entities/Account';
import { TenantRequest } from '../../types/RequestContext';

export interface AuthGuardOptions {
  publicPaths?: RegExp[];
}

export const AuthGuard =
  (dataSource: DataSource, cryptoService: CryptoService, options?: AuthGuardOptions) =>
  async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      if (options?.publicPaths?.some((pattern) => pattern.test(req.path))) {
        return next();
      }

      if (!req.tenant) {
        throw new AppError('Tenant context missing', 400);
      }

      const header = req.headers['authorization'];
      if (!header || !header.toLowerCase().startsWith('bearer ')) {
        return res.status(401).json({ error: 'Authorization header missing' });
      }

      const token = header.substring(7);
      const payload = cryptoService.verifyToken(token);
      if (!payload || payload.tenantId !== req.tenant.id) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      const accountRepo = dataSource.getRepository(Account);
      const account = await accountRepo.findOne({
        where: { id: payload.sub },
        relations: ['tenant'],
      });

      if (!account || account.tenant.id !== req.tenant.id) {
        return res.status(403).json({ error: 'Account not part of tenant' });
      }

      req.account = account;
      req.tokenPayload = payload;
      next();
    } catch (error) {
      next(error);
    }
  };
