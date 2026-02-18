import express from 'express';
import { oauthLimiter, parseBearer } from '../../lib/security';
import { readAccessToken } from '../../lib/oauth';
import { applyTenantSync } from '../../lib/services/tenant-sync';
import { normalizeText } from '../../lib/validation';
import { logActivity } from '../../lib/activity';
import { requestIp, requestUserAgent } from '../../lib/http';
import { optionalString } from './helpers';

export const registerOAuthTenantSyncRoute = (app: express.Express): void => {
  app.post('/api/tenant-sync/upsert', oauthLimiter, async (req, res, next) => {
    try {
      const bearer = parseBearer(req.headers.authorization);
      const context = await readAccessToken(bearer);

      if (!context) {
        res.status(401).json({ error: 'Invalid access token' });
        return;
      }

      const scopes = context.token.scope.split(/\s+/).filter(Boolean);
      if (!scopes.includes('tenant.sync')) {
        res.status(403).json({ error: 'tenant.sync scope is required' });
        return;
      }

      const table = optionalString(req.body.table, 64) as
        | 'users'
        | 'roles'
        | 'organizations'
        | 'user_roles'
        | 'user_orgs';
      const allowedTables = new Set(['users', 'roles', 'organizations', 'user_roles', 'user_orgs']);
      if (!allowedTables.has(table)) {
        res.status(400).json({ error: 'Unsupported table' });
        return;
      }

      const randId = optionalString(req.body.rand_id || req.body.randId, 64);
      if (!randId) {
        res.status(400).json({ error: 'rand_id is required' });
        return;
      }

      const changes = req.body.changes;
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        res.status(400).json({ error: 'changes must be an object' });
        return;
      }

      const result = await applyTenantSync(
        {
          table,
          randId,
          changes,
          reason: normalizeText(req.body.reason || 'tenant-sync', 200),
          actorUserRandId:
            optionalString(req.body.actor_user_rand_id || req.body.actorUserRandId, 64) ||
            context.token.userRandId ||
            undefined,
        },
        context.token.tenantRandId,
      );

      await logActivity({
        eventType: 'tenant.sync.upsert',
        actorUserRandId: context.token.userRandId,
        actorTenantRandId: context.token.tenantRandId,
        targetType: table,
        targetRandId: randId,
        oauthClientId: context.token.clientId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      res.status(200).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });
};
