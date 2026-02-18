import express, { Response } from 'express';
import { normalizeTenantName } from '../lib/services/tenant-whitelist';
import { provisionTenantSso } from '../lib/services/tenant-provisioning';
import { resolveTenantPolicyByClientId } from '../lib/oauth';
import {
  readActiveUserByPhone,
  readUserLoginCapabilities,
} from '../lib/services/auth';

const optionalString = (value: unknown, max = 2048): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, max);
};

const hostFromAbsoluteUrl = (value: string): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.hostname || null;
  } catch {
    return null;
  }
};

export const registerPublicRoutes = (
  app: express.Express,
  opts: {
    requireInternalApiToken: express.RequestHandler;
    clearLoginUiState: (res: Response) => void;
    loginUiStateCookieName: string;
  },
): void => {
  app.post('/api/internal/tenant-sso/register', opts.requireInternalApiToken, async (req, res, next) => {
    try {
      const tenantName = normalizeTenantName(optionalString(req.body?.tenant_name || req.body?.tenantName, 255));
      const tenantRandId = optionalString(req.body?.tenant_rand_id || req.body?.tenantRandId, 64);
      if (!tenantRandId) {
        res.status(400).json({ error: 'tenant_rand_id is required' });
        return;
      }

      const allowRegistrationRaw = req.body?.allow_registration ?? req.body?.allowRegistration;
      const allowRegistration =
        typeof allowRegistrationRaw === 'boolean'
          ? allowRegistrationRaw
          : String(allowRegistrationRaw ?? 'true').trim().toLowerCase() !== 'false';

      const rotateCredentialsRaw = req.body?.rotate_credentials ?? req.body?.rotateCredentials;
      const rotateCredentials =
        typeof rotateCredentialsRaw === 'boolean'
          ? rotateCredentialsRaw
          : String(rotateCredentialsRaw ?? 'false').trim().toLowerCase() === 'true';

      const result = await provisionTenantSso({
        tenantName,
        tenantRandId,
        allowRegistration,
        tenantDisplayName: optionalString(req.body?.tenant_display_name || req.body?.tenantDisplayName, 180) || null,
        callbackUrl: optionalString(req.body?.callback_url || req.body?.callbackUrl, 2048) || null,
        rotateCredentials,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/public/register-policy', async (req, res, next) => {
    try {
      const clientId = optionalString(req.query.client_id, 120);
      const tenantName =
        optionalString(req.query.tenant_name, 255) ||
        hostFromAbsoluteUrl(optionalString(req.query.redirect_uri, 2048)) ||
        '';
      if (!clientId) {
        res.json({ allowRegistration: true, tenant: null });
        return;
      }

      const resolved = await resolveTenantPolicyByClientId(clientId, tenantName || null);
      if (!resolved) {
        res.status(404).json({ allowRegistration: false, error: 'Unknown tenant client' });
        return;
      }

      res.json({
        allowRegistration: resolved.policy.allowRegistration,
        source: resolved.policy.source,
        tenant: {
          randId: resolved.policy.tenantRandId,
          code: resolved.policy.tenantCode,
          name: resolved.policy.tenantDisplayName,
          tenantName: resolved.policy.tenantName,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/public/login-options', async (req, res, next) => {
    try {
      const phoneNumber = optionalString(req.query.phone_number, 32);
      if (!phoneNumber) {
        res.status(400).json({ error: 'phone_number is required' });
        return;
      }

      const user = await readActiveUserByPhone(phoneNumber);
      if (!user) {
        res.status(404).json({ exists: false });
        return;
      }

      const capabilities = readUserLoginCapabilities(user);
      res.status(200).json({
        exists: true,
        phoneNumber: user.phoneNumber,
        methods: {
          password: capabilities.passwordEnabled,
          otp: true,
        },
        defaultMethod: capabilities.passwordEnabled ? 'password' : 'otp',
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/public/login-ui-state', (req, res) => {
    const raw = req.signedCookies?.[opts.loginUiStateCookieName];
    opts.clearLoginUiState(res);
    res.setHeader('Cache-Control', 'no-store');

    if (typeof raw !== 'string' || !raw.trim()) {
      res.status(200).json({ state: {} });
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      res.status(200).json({ state: parsed || {} });
    } catch {
      res.status(200).json({ state: {} });
    }
  });
};
