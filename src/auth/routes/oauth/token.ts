import express from 'express';
import { oauthLimiter } from '../../lib/security';
import {
  consumeAuthorizationCode,
  createAccessToken,
  parseClientAuth,
  readClientById,
  validateTenantSsoTokenForClient,
  verifyClientSecret,
} from '../../lib/oauth';
import { extractTenantNameFromRedirectUri, normalizeTenantName } from '../../lib/services/tenant-whitelist';
import { logActivity } from '../../lib/activity';
import { requestIp, requestUserAgent } from '../../lib/http';
import { optionalString, optionalTenantOrgRandId, readEntityTenantOrgRandId } from './helpers';

export const registerOAuthTokenRoute = (app: express.Express): void => {
  app.post('/oauth/token', oauthLimiter, async (req, res) => {
    try {
      const grantType = optionalString(req.body.grant_type, 40);
      if (grantType !== 'authorization_code') {
        res.status(400).json({ error: 'Unsupported grant_type' });
        return;
      }

      const { clientId, clientSecret } = parseClientAuth(req);
      const client = await readClientById(clientId);

      if (!client || !client.isActive) {
        res.status(401).json({ error: 'Invalid client credentials' });
        return;
      }

      const secretOk = await verifyClientSecret(client, clientSecret);
      if (!secretOk) {
        await logActivity({
          eventType: 'oauth.token.failed',
          actorTenantRandId: client.tenantRandId,
          oauthClientId: client.clientId,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
          payload: { reason: 'invalid_client_secret' },
        });

        res.status(401).json({ error: 'Invalid client credentials' });
        return;
      }

      const code = optionalString(req.body.code, 512);
      const redirectUri = optionalString(req.body.redirect_uri, 2048);
      const codeVerifier = optionalString(req.body.code_verifier, 256);
      const tenantNameFromBodyRaw = optionalString(req.body.tenant_name, 255);
      const tenantNameFromBody = tenantNameFromBodyRaw ? normalizeTenantName(tenantNameFromBodyRaw) : '';
      const tenantOrgRandIdFromBody = optionalTenantOrgRandId(
        req.body.tenant_org_id || req.body.tenantOrgRandId || req.headers['x-tenant-org-id'],
      );
      const tenantNameFromRedirect = redirectUri ? extractTenantNameFromRedirectUri(redirectUri) : '';
      if (tenantNameFromBody && tenantNameFromRedirect && tenantNameFromBody !== tenantNameFromRedirect) {
        res.status(400).json({ error: 'tenant_name must match redirect_uri host tenant' });
        return;
      }
      const tenantName = tenantNameFromBody || tenantNameFromRedirect;
      const tenantSsoToken = optionalString(req.body.tenant_sso_token || req.headers['x-tenant-sso-token'], 512);

      if (!tenantName) {
        res.status(400).json({ error: 'tenant_name is required for token exchange' });
        return;
      }

      await validateTenantSsoTokenForClient({
        tenantName,
        tenantSsoToken,
        client,
      });

      const authorizationCode = await consumeAuthorizationCode({
        code,
        clientId,
        redirectUri,
        codeVerifier,
      });

      if (authorizationCode.tenantName !== tenantName) {
        res.status(400).json({ error: 'tenant_name mismatch for authorization code' });
        return;
      }
      const authorizationCodeTenantOrgRandId = readEntityTenantOrgRandId(authorizationCode);
      if (
        tenantOrgRandIdFromBody &&
        authorizationCodeTenantOrgRandId &&
        authorizationCodeTenantOrgRandId !== tenantOrgRandIdFromBody
      ) {
        res.status(400).json({ error: 'tenant_org_id mismatch for authorization code' });
        return;
      }

      const token = await createAccessToken({
        clientId,
        tenantRandId: authorizationCode.tenantRandId,
        tenantName: authorizationCode.tenantName,
        tenantOrgRandId: authorizationCodeTenantOrgRandId,
        userRandId: authorizationCode.userRandId,
        scope: authorizationCode.scope,
        grantType,
        ipAddress: requestIp(req),
      });

      await logActivity({
        eventType: 'oauth.token.issued',
        actorUserRandId: authorizationCode.userRandId,
        actorTenantRandId: authorizationCode.tenantRandId,
        oauthClientId: client.clientId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: { scope: authorizationCode.scope },
      });

      // OAuth responses should use snake_case fields. Keep camelCase aliases for backward compatibility.
      res.status(200).json({
        access_token: token.accessToken,
        token_type: token.tokenType,
        expires_in: token.expiresIn,
        scope: token.scope,
        accessToken: token.accessToken,
        tokenType: token.tokenType,
        expiresIn: token.expiresIn,
      });
    } catch (error) {
      res.status((error as { statusCode?: number }).statusCode || 400).json({
        error: error instanceof Error ? error.message : 'token_failed',
      });
    }
  });
};
