import express from 'express';
import { oauthLimiter, parseBearer } from '../../lib/security';
import { readAccessToken } from '../../lib/oauth';
import { getUserProfileSnapshot } from '../../lib/services/profile';
import { resolveOrganizationSubtree, resolveTenantOrganizationScope } from '../../lib/services/access-admin';
import { resolveTenantOrgContext } from '../../lib/services/user-tenant-context';
import { readEntityTenantOrgRandId } from './helpers';

export const registerOAuthUserinfoRoute = (app: express.Express): void => {
  app.get('/oauth/userinfo', oauthLimiter, async (req, res) => {
    const token = parseBearer(req.headers.authorization);
    const context = await readAccessToken(token);
    if (!context) {
      res.status(401).json({ error: 'Invalid access token' });
      return;
    }

    const clientMeta = (context.client.meta || {}) as Record<string, unknown>;
    let roleCodes: string[] = [];
    let roleDetails: Array<{
      role_rand_id: string;
      role_code: string;
      role_name: string;
      org_rand_id: string;
      org_name: string | null;
    }> = [];
    let organizations: Array<{
      org_rand_id: string;
      org_code: string;
      org_name: string;
    }> = [];

    const tokenTenantOrgRandId = readEntityTenantOrgRandId(context.token);

    if (context.user?.randId) {
      const profile = await getUserProfileSnapshot(context.user.randId);
      roleDetails = profile.roles
        .filter((role) => role.isAssignmentActive)
        .map((role) => ({
          role_rand_id: role.roleRandId,
          role_code: role.roleCode,
          role_name: role.roleName,
          org_rand_id: role.orgRandId,
          org_name: role.orgName,
        }));
      organizations = profile.organizations
        .filter((org) => org.isAssignmentActive)
        .map((org) => ({
          org_rand_id: org.orgRandId,
          org_code: org.orgCode,
          org_name: org.orgName,
        }));

      const tenantScope = await resolveTenantOrganizationScope(context.token.tenantName);
      if (tokenTenantOrgRandId) {
        const tenantContext = await resolveTenantOrgContext({
          tenantName: context.token.tenantName,
          tenantOrgRandId: tokenTenantOrgRandId,
        });
        if (tenantContext.effectiveOrgRandId) {
          const orgSubtree = await resolveOrganizationSubtree(tenantContext.effectiveOrgRandId);
          const allowedOrgIds = tenantScope.rootOrgRandId
            ? new Set(Array.from(orgSubtree).filter((orgId) => tenantScope.orgIds.has(orgId)))
            : orgSubtree;
          organizations = organizations.filter((org) => allowedOrgIds.has(org.org_rand_id));
          roleDetails = roleDetails.filter((role) => allowedOrgIds.has(role.org_rand_id));
        }
      } else if (tenantScope.rootOrgRandId) {
        organizations = organizations.filter((org) => tenantScope.orgIds.has(org.org_rand_id));
        roleDetails = roleDetails.filter((role) => tenantScope.orgIds.has(role.org_rand_id));
      }

      roleCodes = Array.from(new Set(roleDetails.map((role) => role.role_code.trim()).filter(Boolean)));
    }

    res.status(200).json({
      sub: context.user?.randId || null,
      email: context.user?.email || null,
      given_name: context.user?.firstName || null,
      family_name: context.user?.lastName || null,
      role: roleCodes[0] || null,
      role_code: roleCodes[0] || null,
      roles: roleCodes,
      role_details: roleDetails,
      organizations,
      groups: roleCodes,
      tenant_rand_id: context.token.tenantRandId,
      tenant_name: context.token.tenantName,
      tenant_org_rand_id: tokenTenantOrgRandId,
      tenant_code: typeof clientMeta.tenantCode === 'string' ? clientMeta.tenantCode : null,
      client_id: context.token.clientId,
      scope: context.token.scope,
    });
  });
};
