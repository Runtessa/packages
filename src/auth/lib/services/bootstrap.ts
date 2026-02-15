import { AuthDataSource } from '../db';
import { hashPassword, randomId } from '../crypto';
import { OAuthClientEntity } from '../typeorm/entities';
import { findCurrentUserByEmail, schemas, upsertVersionedRecord } from './versioning';
import {
  createOrUpdateWhitelistTenant,
  extractTenantNameFromRedirectUri,
} from './tenant-whitelist';

const env = (key: string, fallback = ''): string => (process.env[key] || '').trim() || fallback;

const toBool = (value: string, fallback = false): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

interface BootstrapLogger {
  log: (message: string) => void;
}

const defaultLogger: BootstrapLogger = {
  log: (message) => {
    console.log(message);
  },
};

const seedTenantWhitelist = async (tenantRandId: string, logger: BootstrapLogger): Promise<void> => {
  const redirectUri = env('AUTH_BOOTSTRAP_REDIRECT_URI', 'http://localhost:3002/auth');
  const tenantName =
    env('AUTH_BOOTSTRAP_TENANT_NAME_HOST', '') || extractTenantNameFromRedirectUri(redirectUri);
  const explicitToken = (process.env.AUTH_BOOTSTRAP_TENANT_SSO_TOKEN || '').trim();
  const allowRegistration = toBool(env('AUTH_BOOTSTRAP_TENANT_ALLOW_REGISTRATION', 'true'), true);
  const tenantDisplayName = env('AUTH_BOOTSTRAP_TENANT_NAME', 'Default Tenant');

  const { plainToken } = await createOrUpdateWhitelistTenant({
    tenantName,
    tenantRandId,
    token: explicitToken || undefined,
    isActive: true,
    meta: {
      allowRegistration,
      tenantDisplayName,
      bootstrap: true,
    },
  });

  logger.log(`[auth-service] tenant whitelist entry upserted: ${tenantName}`);
  if (plainToken) {
    logger.log(`[auth-service] tenant sso token: ${plainToken}`);
  }
};

const seedClient = async (tenantRandId: string, logger: BootstrapLogger): Promise<void> => {
  const clientId = env('AUTH_BOOTSTRAP_CLIENT_ID', 'idp-tenant-client');
  const clientSecret = env('AUTH_BOOTSTRAP_CLIENT_SECRET', 'change-me-client-secret');
  const redirectUri = env('AUTH_BOOTSTRAP_REDIRECT_URI', 'http://localhost:3002/auth');

  const repo = AuthDataSource.getRepository(OAuthClientEntity);
  const existing = await repo.findOne({ where: { clientId } });

  if (existing) {
    logger.log(`[auth-service] oauth client exists: ${clientId}`);
    return;
  }

  const row = repo.create({
    randId: randomId(16),
    clientId,
    clientSecretHash: await hashPassword(clientSecret),
    tenantRandId,
    name: 'Default IDP Tenant Client',
    allowedRedirectUris: [new URL(redirectUri).origin + '/auth'],
    allowedScopes: ['openid', 'profile', 'email', 'tenant.sync'],
    requirePkce: true,
    isActive: true,
    meta: {
      bootstrap: true,
      allowRegistration: true,
      tenantCode: env('AUTH_BOOTSTRAP_TENANT_CODE', 'default'),
      tenantName: env('AUTH_BOOTSTRAP_TENANT_NAME', 'Default Tenant'),
    },
  });

  await repo.save(row);
  logger.log(`[auth-service] oauth client created: ${clientId}`);
  logger.log(`[auth-service] oauth client secret: ${clientSecret}`);
};

const seedAdmin = async (tenantRandId: string, logger: BootstrapLogger): Promise<void> => {
  const email = env('AUTH_BOOTSTRAP_ADMIN_EMAIL', 'admin@example.com').toLowerCase();
  const password = env('AUTH_BOOTSTRAP_ADMIN_PASSWORD', 'change-me-admin-password');

  const existing = await findCurrentUserByEmail(email);
  if (existing) {
    logger.log(`[auth-service] admin user exists: ${email}`);
    return;
  }

  const userRandId = randomId(16);
  await upsertVersionedRecord(
    schemas.users,
    userRandId,
    {
      nationalId: `ADMIN-${Date.now()}`,
      phoneNumber: '+10000000000',
      isPhoneVerified: false,
      registeredAt: new Date(),
      isActive: true,
      firstName: 'Platform',
      lastName: 'Admin',
      email,
      passwordHash: await hashPassword(password),
      meta: { bootstrap: true, authAdmin: true },
    },
    {
      actorTenantRandId: tenantRandId,
      changeReason: 'bootstrap-admin-user',
    },
  );

  await upsertVersionedRecord(
    schemas.organizations,
    env('AUTH_BOOTSTRAP_ORG_RAND_ID', `${tenantRandId}-org`),
    {
      name: env('AUTH_BOOTSTRAP_ORG_NAME', 'Default Organization'),
      code: env('AUTH_BOOTSTRAP_ORG_CODE', 'default-org'),
      parentOrgRandId: null,
      isActive: true,
      meta: { bootstrap: true },
    },
    {
      actorTenantRandId: tenantRandId,
      changeReason: 'bootstrap-default-organization',
    },
  );

  logger.log(`[auth-service] admin user created: ${email}`);
  logger.log(`[auth-service] admin password: ${password}`);
};

export const bootstrapAuthDefaults = async (logger: BootstrapLogger = defaultLogger): Promise<void> => {
  const tenantRandId = env('AUTH_BOOTSTRAP_TENANT_RAND_ID', 'tenant-default');
  await seedTenantWhitelist(tenantRandId, logger);
  await seedClient(tenantRandId, logger);
  await seedAdmin(tenantRandId, logger);
};
