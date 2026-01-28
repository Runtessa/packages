import { NextFunction, Response } from "express";
import { DataSource } from "typeorm";
import { AppError } from "../../common/AppError";
import { CryptoService } from "../../core/security/CryptoService";
import { Account } from "../../entities/Account";
import { TenantRequest } from "../../types/RequestContext";

export interface AuthGuardOptions {
  publicPaths?: RegExp[];
}

export const AuthGuard =
  (dataSource: DataSource, cryptoService: CryptoService) =>
  async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.tenant) {
        throw new AppError("Tenant context missing", 400);
      }
      const requiresAuth = Boolean(req.tenant.restrictRoutes?.includes(req.path));
      const header = req.headers["authorization"];
      const hasBearer =
        typeof header === "string" && header.toLowerCase().startsWith("bearer ");

      let payload = null as ReturnType<typeof cryptoService.verifyToken> | null;
      if (hasBearer) {
        const token = header.substring(7);
        payload = cryptoService.verifyToken(token);
        if (payload && payload.tenantId === req.tenant.id) {
          req.tokenPayload = payload;
        } else if (requiresAuth) {
          return res.status(401).json({ error: "Invalid token" });
        }
      } else if (requiresAuth) {
        return res.status(401).json({ error: "Authorization header missing" });
      }

      if (requiresAuth && payload) {
        const accountRepo = dataSource.getRepository(Account);
        const account = await accountRepo.findOne({
          where: { id: payload.sub },
          relations: ["tenant"],
        });

        if (!account || account.tenant.id !== req.tenant.id) {
          return res.status(403).json({ error: "Account not part of tenant" });
        }

        req.account = account;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
