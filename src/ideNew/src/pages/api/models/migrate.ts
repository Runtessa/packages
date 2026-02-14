import { NextApiRequest, NextApiResponse } from 'next';
import { DataSource } from 'typeorm';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { OrmModel, Secret, Tenant } from '@idp/shared';
import { resolveTenant } from '@/lib/tenancy';
import { decryptSecret } from '@/lib/crypto';
import { decryptPasswordFields } from '@/lib/adapter-config-passwords';
import { loadOrmEntities } from '@/lib/orm-loader';
import { compileOrmSource } from '@/lib/orm-compiler';

type AdapterConfig = Record<string, unknown> | string;

const normalizeKey = (raw: unknown) => {
  if (!raw) return '';
  if (typeof raw !== 'string') {
    const err = new Error('adapterKey must be a string');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim();
};

const parseAdapterKey = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return { adapter: 'postgres', key: '' };
  if (trimmed.includes(':')) {
    const [adapter, ...rest] = trimmed.split(':');
    return { adapter: adapter.toLowerCase(), key: rest.join(':') };
  }
  return { adapter: 'postgres', key: trimmed };
};

const ensureAdapterAccess = (tenant: Tenant, adapter: string, key: string) => {
  const access = tenant.adapterAccess ?? {};
  const rule = (access as Record<string, { allow?: string[] } | undefined>)[adapter];
  const allow = rule?.allow ?? [];
  if (!allow.length) {
    const err = new Error(`Access denied: ${adapter} adapter is not enabled for tenant`);
    (err as any).statusCode = 403;
    throw err;
  }
  if (allow.includes('*')) return;
  if (!allow.includes(key) && !allow.includes(key.toLowerCase())) {
    const err = new Error(`Access denied: ${adapter} adapter cannot access ${key}`);
    (err as any).statusCode = 403;
    throw err;
  }
};

const resolveSecretValue = async (tenant: Tenant, adapter: string, key: string) => {
  const repo = CoreDataSource.getRepository(Secret);
  const rawKey = key.trim();
  const lowerKey = rawKey.toLowerCase();
  const adapterLower = adapter.toLowerCase();
  const candidates = [
    `${adapterLower}:${lowerKey}`,
    `${adapterLower}:${rawKey}`,
    lowerKey,
    rawKey,
  ];
  for (const candidate of candidates) {
    const secret = await repo.findOne({ where: { tenant: { id: tenant.id }, keyName: candidate } });
    if (!secret) continue;
    return decryptSecret({
      encryptedValue: secret.encryptedValue,
      authTag: secret.authTag,
      iv: secret.iv,
    });
  }
  const err = new Error(`Secret ${rawKey} not found for tenant`);
  (err as any).statusCode = 404;
  throw err;
};

const selectReadWriteConfig = (secretValue: string, mode: 'read' | 'write'): AdapterConfig => {
  try {
    const parsed = JSON.parse(secretValue);
    if (!parsed || typeof parsed !== 'object') return secretValue;
    if ('read' in (parsed as any) || 'write' in (parsed as any)) {
      const readVal = (parsed as any).read;
      const writeVal = (parsed as any).write;
      const selected = mode === 'read' ? (readVal ?? writeVal) : (writeVal ?? readVal);
      if (Array.isArray(selected)) return selected[0] ?? secretValue;
      return selected ?? secretValue;
    }
    return parsed as AdapterConfig;
  } catch {
    return secretValue;
  }
};

const normalizeDbConfig = (config: Record<string, unknown>) => {
  const normalized = { ...config } as Record<string, unknown>;
  if (!normalized.user && typeof normalized.username === 'string') {
    normalized.user = normalized.username;
  }
  if (!normalized.username && typeof normalized.user === 'string') {
    normalized.username = normalized.user;
  }
  if (typeof normalized.port === 'string' && normalized.port.trim()) {
    const parsed = Number.parseInt(normalized.port, 10);
    if (Number.isFinite(parsed)) {
      normalized.port = parsed;
    }
  }
  return normalized;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  await requireUser(req);
  const tenant = await resolveTenant(req);
  const adapterKey = normalizeKey(req.body?.adapterKey);
  const parsed = parseAdapterKey(adapterKey);
  const adapter = parsed.adapter;
  let key = parsed.key;
  if (!key) {
    const access = tenant.adapterAccess ?? {};
    const rule = (access as Record<string, { allow?: string[] } | undefined>)[adapter];
    const allow = rule?.allow ?? [];
    if (!allow.length) {
      res.status(403).json({ error: `Access denied: ${adapter} adapter is not enabled for tenant` });
      return;
    }
    key = allow[0];
  }

  if (!['postgres', 'mysql', 'mssql'].includes(adapter)) {
    res.status(400).json({ error: `Unsupported adapter: ${adapter}` });
    return;
  }

  ensureAdapterAccess(tenant, adapter, key);

  const modelRepo = CoreDataSource.getRepository(OrmModel);
  const models = await modelRepo.find({
    where: { tenant: { id: tenant.id } },
    order: { path: 'ASC' },
  });
  if (!models.length) {
    res.status(400).json({ error: 'No ORM models defined for tenant' });
    return;
  }

  const modelSources = models.map((model) => {
    const code = model.code || '';
    const ext = model.fileExtension || 'js';
    if (model.codeBlob) {
      return { path: model.path, code: model.codeBlob };
    }
    try {
      return { path: model.path, code: compileOrmSource(code, ext) };
    } catch (err) {
      const error = new Error(
        `Failed to compile model ${model.path}: ${(err as Error).message}`
      );
      (error as any).statusCode = 400;
      throw error;
    }
  });
  let entities: any[] = [];
  try {
    ({ entities } = loadOrmEntities(modelSources));
  } catch (err) {
    const error = new Error(
      `Failed to load ORM entities: ${(err as Error).message}`
    );
    (error as any).statusCode = 400;
    throw error;
  }
  if (!entities.length) {
    res.status(400).json({ error: 'No valid TypeORM entities found' });
    return;
  }

  const secretValue = await resolveSecretValue(tenant, adapter, key);
  const config = selectReadWriteConfig(secretValue, 'write');
  let resolvedConfig: AdapterConfig = config;
  if (typeof config !== 'string' && config) {
    resolvedConfig = decryptPasswordFields(config as Record<string, unknown>);
  } else if (typeof config === 'string' && config.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(config);
      if (parsed && typeof parsed === 'object') {
        resolvedConfig = decryptPasswordFields(parsed as Record<string, unknown>);
      }
    } catch {
      // keep string config
    }
  }

  const dataSource = new DataSource({
    type: adapter as 'postgres' | 'mysql' | 'mssql',
    ...(typeof resolvedConfig === 'string'
      ? { url: resolvedConfig }
      : normalizeDbConfig(resolvedConfig as Record<string, unknown>)),
    entities,
    synchronize: false,
    logging: false,
  } as any);

  await dataSource.initialize();
  await dataSource.synchronize();
  await dataSource.destroy();

  res.status(200).json({ ok: true, entities: entities.length });
});
