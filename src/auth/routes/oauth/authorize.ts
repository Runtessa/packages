import express, { Response } from 'express';
import { oauthLimiter } from '../../lib/security';
import { assertCode } from '../../lib/validation';
import { requestIp, requestUserAgent, safeReturnTo } from '../../lib/http';
import {
  assertScopeAllowed,
  createAuthorizationCode,
  readClientById,
  validateAuthorizeRedirect,
} from '../../lib/oauth';
import { normalizeTenantName } from '../../lib/services/tenant-whitelist';
import { resolveTenantOrgContext } from '../../lib/services/user-tenant-context';
import { logActivity } from '../../lib/activity';
import {
  appendQuery,
  appendAuthContext,
  hostFromAbsoluteUrl,
  optionalString,
  optionalTenantOrgRandId,
  toLoginFriendlyError,
  wantsJson,
} from './helpers';

export const registerOAuthAuthorizeRoute = (
  app: express.Express,
  opts: { setLoginUiState: (res: Response, state: { mode?: 'signin' | 'signup'; error?: string }) => void },
): void => {
  app.get('/oauth/authorize', oauthLimiter, async (req, res) => {
    const respondAuthorizeError = (statusCode: number, errorMessage: string): void => {
      if (wantsJson(req)) {
        res.status(statusCode).json({ error: errorMessage });
        return;
      }

      const clientIdHint = optionalString(req.query.client_id, 120);
      const tenantNameHint =
        optionalString(req.query.tenant_name, 255) ||
        hostFromAbsoluteUrl(optionalString(req.query.redirect_uri, 2048)) ||
        '';
      const tenantOrgRandIdHint = optionalTenantOrgRandId(req.query.tenant_org_id || req.query.tenantOrgRandId);

      opts.setLoginUiState(res, {
        mode: 'signin',
        error: toLoginFriendlyError(errorMessage),
      });
      res.redirect(
        appendAuthContext('/login', {
          returnTo: '/profile',
          clientId: clientIdHint || undefined,
          tenantName: tenantNameHint || undefined,
          tenantOrgRandId: tenantOrgRandIdHint || undefined,
        }),
      );
    };

    try {
      const responseType = optionalString(req.query.response_type, 16);
      const clientId = assertCode(req.query.client_id, 'client_id');
      const redirectUri = optionalString(req.query.redirect_uri, 2048);
      const tenantNameHintRaw = optionalString(req.query.tenant_name, 255);
      const tenantNameHint = tenantNameHintRaw ? normalizeTenantName(tenantNameHintRaw) : '';
      const tenantOrgRandIdHint = optionalTenantOrgRandId(req.query.tenant_org_id || req.query.tenantOrgRandId);
      const scopeRaw = optionalString(req.query.scope, 2000);
      const state = optionalString(req.query.state, 4096);
      const codeChallenge = optionalString(req.query.code_challenge, 256);
      const codeChallengeMethod = optionalString(req.query.code_challenge_method, 16);

      if (responseType !== 'code') {
        respondAuthorizeError(400, 'Only authorization code flow is supported');
        return;
      }

      const client = await readClientById(clientId);
      if (!client || !client.isActive) {
        respondAuthorizeError(400, 'Unknown client_id');
        return;
      }

      const redirectContext = await validateAuthorizeRedirect(client, redirectUri);
      if (tenantNameHint && tenantNameHint !== redirectContext.tenantName) {
        respondAuthorizeError(400, 'tenant_name must match redirect_uri host tenant');
        return;
      }
      const tenantContext = await resolveTenantOrgContext({
        tenantName: redirectContext.tenantName,
        tenantOrgRandId: tenantOrgRandIdHint || null,
      });
      const scope = assertScopeAllowed(client, scopeRaw);

      if (client.requirePkce && !codeChallenge) {
        respondAuthorizeError(400, 'PKCE is required for this client');
        return;
      }

      if (!req.sessionContext) {
        const returnTo = safeReturnTo(req.originalUrl, '/login');
        const loginUrl = `/login?returnTo=${encodeURIComponent(returnTo)}&client_id=${encodeURIComponent(clientId)}&tenant_name=${encodeURIComponent(redirectContext.tenantName)}${
          tenantContext.effectiveOrgRandId ? `&tenant_org_id=${encodeURIComponent(tenantContext.effectiveOrgRandId)}` : ''
        }`;
        res.redirect(loginUrl);
        return;
      }

      const code = await createAuthorizationCode({
        clientId,
        tenantRandId: client.tenantRandId,
        tenantName: redirectContext.tenantName,
        tenantOrgRandId: tenantContext.effectiveOrgRandId || null,
        userRandId: req.sessionContext.user.randId,
        redirectUri,
        scope,
        codeChallenge: codeChallenge || null,
        codeChallengeMethod: codeChallengeMethod || null,
        state: state || null,
      });

      await logActivity({
        eventType: 'oauth.code.issued',
        actorUserRandId: req.sessionContext.user.randId,
        actorTenantRandId: client.tenantRandId,
        targetType: 'oauth_client',
        targetRandId: client.randId,
        oauthClientId: client.clientId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: { scope },
      });

      let callback = appendQuery(redirectUri, 'code', code);
      callback = appendQuery(callback, 'state', state || null);
      res.redirect(callback);
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode || 400;
      const message = error instanceof Error ? error.message : 'authorize_failed';
      respondAuthorizeError(statusCode, message);
    }
  });
};
