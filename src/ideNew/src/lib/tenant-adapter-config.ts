const ADAPTER_KEYS = ['postgres', 'mysql', 'mssql', 'redis', 'kafka', 's3'] as const;

type AdapterAccess = Record<string, { allow: string[] }>;

const normalizeAllowList = (raw: unknown): string[] => {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[\n,]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeConnections = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== 'object') return {};
  const entries: Record<string, string> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    entries[key] = trimmed;
  });
  return entries;
};

const normalizeAdapterKey = (raw: string) => raw.trim().toLowerCase();

const serializeConfigValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const normalizeAdaptersRoot = (config: Record<string, unknown>) => {
  const root = (config.adapters ?? config) as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  Object.entries(root || {}).forEach(([key, value]) => {
    const lower = key.toLowerCase();
    normalized[lower] = value;
  });
  return normalized;
};

export const parseAdapterConfig = (
  raw: unknown
): { adapterAccess: AdapterAccess; secrets: Record<string, string> | null } => {
  if (raw === undefined || raw === null) {
    return { adapterAccess: {}, secrets: null };
  }
  let config: any = raw;
  if (typeof raw === 'string') {
    try {
      config = JSON.parse(raw);
    } catch {
      const err = new Error('adapterConfig must be valid JSON');
      (err as any).statusCode = 400;
      throw err;
    }
  }
  if (!config || typeof config !== 'object') {
    const err = new Error('adapterConfig must be an object');
    (err as any).statusCode = 400;
    throw err;
  }
  const adapters = normalizeAdaptersRoot(config);
  const adapterAccess: AdapterAccess = {};
  const secrets: Record<string, string> = {};

  ADAPTER_KEYS.forEach((adapter) => {
    const block = adapters[adapter];
    if (!block || typeof block !== 'object') return;
    const blockObj = block as Record<string, unknown>;
    const hasLegacyShape = ['allow', 'allowed', 'whitelist', 'connections', 'connectionStrings', 'secrets'].some(
      (key) => key in blockObj
    );

    if (hasLegacyShape) {
      const allow = normalizeAllowList(
        blockObj.allow ?? blockObj.allowed ?? blockObj.whitelist
      );
      const connections = normalizeConnections(
        blockObj.connections ?? blockObj.connectionStrings ?? blockObj.secrets
      );
      const allowList = allow.length ? allow : Object.keys(connections);
      if (allowList.length) {
        adapterAccess[adapter] = { allow: allowList };
      }
      Object.entries(connections).forEach(([key, value]) => {
        secrets[key] = value;
      });
      return;
    }

    const keys = Object.keys(blockObj);
    const allowList: string[] = [];
    keys.forEach((rawKey) => {
      const adapterKey = normalizeAdapterKey(rawKey);
      if (!adapterKey) return;
      const value = blockObj[rawKey];
      const serialized = serializeConfigValue(value);
      if (serialized) {
        secrets[`${adapter}:${adapterKey}`] = serialized;
        allowList.push(adapterKey);
      }
    });
    if (allowList.length) {
      adapterAccess[adapter] = { allow: allowList };
    }
  });

  return { adapterAccess, secrets: Object.keys(secrets).length ? secrets : null };
};

export const buildAdapterConfigTemplate = (
  adapterAccess: AdapterAccess,
  secretKeys: string[]
) => {
  const config: Record<string, any> = { adapters: {} as Record<string, any> };
  const secretMap: Record<string, string[]> = {};
  secretKeys.forEach((key) => {
    const match = key.split(':');
    if (match.length >= 2) {
      const adapter = match[0]?.toLowerCase();
      const name = match.slice(1).join(':');
      if (!adapter || !name) return;
      secretMap[adapter] = secretMap[adapter] || [];
      if (!secretMap[adapter].includes(name)) {
        secretMap[adapter].push(name);
      }
    }
  });

  const defaultDbConfig = {
    read: [
      {
        host: '',
        port: '',
        username: '',
        password: '',
        database: '',
      },
    ],
    write: {
      host: '',
      port: '',
      username: '',
      password: '',
      database: '',
    },
  };

  const defaultRedisConfig = { url: '' };
  const defaultKafkaConfig = { brokers: [] as string[] };
  const defaultS3Config = {
    endpoint: '',
    region: 'us-east-1',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: false,
  };

  ADAPTER_KEYS.forEach((adapter) => {
    const allow = adapterAccess[adapter]?.allow ?? [];
    const keys = new Set<string>([...allow, ...(secretMap[adapter] || [])]);
    if (!keys.size) return;
    const block: Record<string, unknown> = {};
    keys.forEach((key) => {
      if (adapter === 'postgres' || adapter === 'mysql' || adapter === 'mssql') {
        block[key] = defaultDbConfig;
      } else if (adapter === 'redis') {
        block[key] = defaultRedisConfig;
      } else if (adapter === 'kafka') {
        block[key] = defaultKafkaConfig;
      } else if (adapter === 's3') {
        block[key] = defaultS3Config;
      }
    });
    (config.adapters as Record<string, any>)[adapter] = block;
  });
  return JSON.stringify(config, null, 2);
};
