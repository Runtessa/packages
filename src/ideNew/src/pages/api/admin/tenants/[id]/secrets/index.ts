import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { encryptSecret } from '@/lib/crypto';
import { Secret, Tenant } from '@idp/shared';
import {
  assertTenantReadableForUser,
  assertTenantWritableForUser,
} from '@/lib/team-tenant-access';

const getTenantId = (req: NextApiRequest) => {
  const raw = req.query.id;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    const error = new Error('tenant id is required');
    (error as any).statusCode = 400;
    throw error;
  }
  return value;
};

const normalizeKeyName = (raw: unknown) => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const error = new Error('keyName is required');
    (error as any).statusCode = 400;
    throw error;
  }
  const keyName = raw.trim();
  if (!/^[A-Za-z0-9:_\-.]+$/.test(keyName)) {
    const error = new Error('keyName contains invalid characters');
    (error as any).statusCode = 400;
    throw error;
  }
  return keyName;
};

const normalizeSecretValue = (raw: unknown) => {
  if (typeof raw !== 'string') {
    const error = new Error('value must be a string');
    (error as any).statusCode = 400;
    throw error;
  }
  if (!raw.length) {
    const error = new Error('value cannot be empty');
    (error as any).statusCode = 400;
    throw error;
  }
  return raw;
};

const serializeSecret = (secret: Secret) => ({
  keyName: secret.keyName,
  createdAt: secret.createdAt,
  updatedAt: secret.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const user = await requireAdmin(req);
  await ensureCoreSchema();

  const tenantId = getTenantId(req);
  const tenantRepo = CoreDataSource.getRepository(Tenant);
  const secretRepo = CoreDataSource.getRepository(Secret);

  const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  if (req.method === 'GET') {
    await assertTenantReadableForUser(user, tenant.id);
    const secrets = await secretRepo.find({
      where: { tenant: { id: tenant.id } },
      order: { keyName: 'ASC' },
    });
    res.status(200).json({ secrets: secrets.map(serializeSecret) });
    return;
  }

  if (req.method === 'POST') {
    await assertTenantWritableForUser(user, tenant.id);
    const keyName = normalizeKeyName(req.body?.keyName);
    const value = normalizeSecretValue(req.body?.value);
    const encrypted = encryptSecret(value);

    let secret = await secretRepo.findOne({
      where: { tenant: { id: tenant.id }, keyName },
    });
    if (!secret) {
      secret = secretRepo.create({
        tenant,
        keyName,
        encryptedValue: encrypted.encryptedValue,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      });
    } else {
      secret.encryptedValue = encrypted.encryptedValue;
      secret.iv = encrypted.iv;
      secret.authTag = encrypted.authTag;
    }

    await secretRepo.save(secret);
    res.status(200).json({ secret: serializeSecret(secret) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
