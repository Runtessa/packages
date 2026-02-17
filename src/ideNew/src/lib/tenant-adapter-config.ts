const ADAPTER_KEYS = ['postgres', 'mysql', 'mssql', 'redis', 'kafka', 's3'] as const;

type AdapterAccess = Record<string, { allow: string[] }>;

const REFERENCE_PATTERN = /^[a-z0-9._-]+(?::[a-z0-9._-]+)+$/i;

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

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isReferenceString = (value: unknown) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return REFERENCE_PATTERN.test(trimmed);
};

const hasReferenceLikeShape = (value: unknown, depth = 0): boolean => {
  if (depth > 8) return false;
  if (Array.isArray(value)) {
    return value.some((entry) => hasReferenceLikeShape(entry, depth + 1));
  }
  if (isReferenceString(value)) return true;
  if (!isObject(value)) return false;

  const explicitRefKeys = [
    'secretRef',
    'secret_ref',
    'secretKey',
    'secret_key',
    'ref',
    'key',
    'readSecretRef',
    'read_secret_ref',
    'readRef',
    'read_ref',
    'writeSecretRef',
    'write_secret_ref',
    'writeRef',
    'write_ref',
  ];
  if (explicitRefKeys.some((key) => isReferenceString(value[key]))) return true;

  const readWriteKeys = ['read', 'write'];
  if (readWriteKeys.some((key) => hasReferenceLikeShape(value[key], depth + 1))) return true;

  const stageContainerKeys = ['stages', 'byStage', 'by_stage', 'environments', 'envs'];
  for (const containerKey of stageContainerKeys) {
    const container = value[containerKey];
    if (!isObject(container)) continue;
    if (Object.values(container).some((entry) => hasReferenceLikeShape(entry, depth + 1))) {
      return true;
    }
  }

  if (hasReferenceLikeShape(value.default, depth + 1)) return true;
  if (hasReferenceLikeShape(value.fallback, depth + 1)) return true;

  const stageKeys = [
    'dev',
    'development',
    'local',
    'test',
    'qa',
    'prerelease',
    'pre-release',
    'staging',
    'stage',
    'uat',
    'publish',
    'production',
    'prod',
  ];
  if (stageKeys.some((key) => hasReferenceLikeShape(value[key], depth + 1))) return true;

  return false;
};

const parseSecretKeyParts = (keyName: string): { adapter: string; adapterKey: string } | null => {
  const trimmed = String(keyName || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  if (parts[0]?.toLowerCase() === 'adapter' && parts.length >= 3) {
    const adapter = parts[1].toLowerCase();
    const adapterKey = parts[2].toLowerCase();
    if (!ADAPTER_KEYS.includes(adapter as (typeof ADAPTER_KEYS)[number])) return null;
    if (!adapterKey) return null;
    return { adapter, adapterKey };
  }

  const adapter = parts[0].toLowerCase();
  if (!ADAPTER_KEYS.includes(adapter as (typeof ADAPTER_KEYS)[number])) return null;
  const adapterKey = parts[1].toLowerCase();
  if (!adapterKey) return null;
  return { adapter, adapterKey };
};

const uniqueList = (values: string[]) => Array.from(new Set(values));
const SQL_ADAPTERS = new Set(['postgres', 'mysql', 'mssql']);

const isSqlAdapter = (adapter: string) => SQL_ADAPTERS.has(adapter);

const buildDefaultSecretKey = (adapter: string, key: string) =>
  `adapter:${adapter}:${key}:default`;

const buildReadWriteSecretKey = (adapter: string, key: string, mode: 'read' | 'write') =>
  `adapter:${adapter}:${key}:default:${mode}`;

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
      const allow = normalizeAllowList(blockObj.allow ?? blockObj.allowed ?? blockObj.whitelist);
      const connections = normalizeConnections(
        blockObj.connections ?? blockObj.connectionStrings ?? blockObj.secrets
      );
      const allowList = allow.length ? allow : Object.keys(connections);
      if (allowList.length) {
        adapterAccess[adapter] = { allow: uniqueList(allowList) };
      }
      Object.entries(connections).forEach(([key, value]) => {
        secrets[key] = value;
      });
      return;
    }

    const allowList: string[] = [];
    Object.entries(blockObj).forEach(([rawKey, value]) => {
      const adapterKey = normalizeAdapterKey(rawKey);
      if (!adapterKey) return;

      if (value === undefined || value === null || value === '') return;

      allowList.push(adapterKey);
      if (hasReferenceLikeShape(value)) {
        return;
      }

      if (isSqlAdapter(adapter)) {
        const objectValue = isObject(value) ? value : {};
        const readValue = objectValue.read ?? objectValue.write ?? value;
        const writeValue = objectValue.write ?? objectValue.read ?? value;
        const readItems = Array.isArray(readValue) ? readValue : [readValue];
        const readSerializedValues = readItems
          .map((entry) => serializeConfigValue(entry))
          .filter((entry): entry is string => Boolean(entry));
        const writeSerialized = serializeConfigValue(writeValue);
        readSerializedValues.forEach((serialized, index) => {
          secrets[`${buildReadWriteSecretKey(adapter, adapterKey, 'read')}:${index + 1}`] =
            serialized;
        });
        if (writeSerialized) {
          secrets[buildReadWriteSecretKey(adapter, adapterKey, 'write')] = writeSerialized;
        }
        return;
      }

      const serialized = serializeConfigValue(value);
      if (serialized) {
        secrets[buildDefaultSecretKey(adapter, adapterKey)] = serialized;
      }
    });

    if (allowList.length) {
      adapterAccess[adapter] = { allow: uniqueList(allowList) };
    }
  });

  return { adapterAccess, secrets: Object.keys(secrets).length ? secrets : null };
};

const STAGE_KEYS = ['dev', 'test', 'prerelease', 'publish'] as const;

const buildSingleSecretRef = (adapter: string, key: string) => ({
  default: `adapter:${adapter}:${key}:default`,
  stages: STAGE_KEYS.reduce<Record<string, string>>((acc, stage) => {
    acc[stage] = `adapter:${adapter}:${key}:${stage}`;
    return acc;
  }, {}),
});

const buildReadWriteSecretRef = (adapter: string, key: string) => ({
  default: {
    read: [`adapter:${adapter}:${key}:default:read:1`],
    write: `adapter:${adapter}:${key}:default:write`,
  },
  stages: STAGE_KEYS.reduce<Record<string, { read: string[]; write: string }>>((acc, stage) => {
    acc[stage] = {
      read: [`adapter:${adapter}:${key}:${stage}:read:1`],
      write: `adapter:${adapter}:${key}:${stage}:write`,
    };
    return acc;
  }, {}),
});

const DEFAULT_TEMPLATE_CONFIG = {
  adapters: {
    postgres: {
      primary: buildReadWriteSecretRef('postgres', 'primary'),
    },
    mysql: {},
    mssql: {},
    redis: {
      cache: buildSingleSecretRef('redis', 'cache'),
    },
    kafka: {
      events: buildSingleSecretRef('kafka', 'events'),
    },
    s3: {
      assets: buildSingleSecretRef('s3', 'assets'),
    },
  },
};

export const DEFAULT_ADAPTER_CONFIG_TEMPLATE = JSON.stringify(DEFAULT_TEMPLATE_CONFIG, null, 2);

const asConfigObject = (raw: unknown): Record<string, unknown> => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const err = new Error('adapterConfig must be valid JSON');
      (err as any).statusCode = 400;
      throw err;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const err = new Error('adapterConfig must be an object');
      (err as any).statusCode = 400;
      throw err;
    }
    return parsed as Record<string, unknown>;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const err = new Error('adapterConfig must be an object');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw as Record<string, unknown>;
};

const normalizeSqlReadRefList = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : [value];
  const list = values
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length ? list : [];
};

const normalizeSqlSecretRefShape = (value: unknown): unknown => {
  if (!isObject(value)) return value;
  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...source };

  const normalizeReadWriteObject = (node: unknown): unknown => {
    if (!isObject(node)) return node;
    const valueNode = node as Record<string, unknown>;
    const next: Record<string, unknown> = { ...valueNode };
    if ('read' in valueNode) {
      const readRefs = normalizeSqlReadRefList(valueNode.read);
      if (readRefs.length) {
        next.read = readRefs;
      }
    }
    return next;
  };

  if ('default' in normalized) {
    normalized.default = normalizeReadWriteObject(normalized.default);
  }

  if (isObject(normalized.stages)) {
    const stageBlock: Record<string, unknown> = {};
    Object.entries(normalized.stages as Record<string, unknown>).forEach(([stage, stageValue]) => {
      stageBlock[stage] = normalizeReadWriteObject(stageValue);
    });
    normalized.stages = stageBlock;
  }

  if ('read' in normalized) {
    const readRefs = normalizeSqlReadRefList(normalized.read);
    if (readRefs.length) {
      normalized.read = readRefs;
    }
  }

  return normalized;
};

export const canonicalizeAdapterConfig = (raw: unknown): Record<string, unknown> => {
  const config = asConfigObject(raw);
  const adaptersRaw = ((config.adapters ?? {}) as Record<string, unknown>) || {};
  const adapters = normalizeAdaptersRoot(config);
  const normalizedAdapters: Record<string, unknown> = {};

  Object.entries(adaptersRaw).forEach(([rawKey, value]) => {
    const lower = rawKey.toLowerCase();
    if (!ADAPTER_KEYS.includes(lower as (typeof ADAPTER_KEYS)[number])) {
      normalizedAdapters[rawKey] = value;
    }
  });

  ADAPTER_KEYS.forEach((adapter) => {
    const block = adapters[adapter];
    if (!isObject(block)) {
      if (adapter in adaptersRaw) normalizedAdapters[adapter] = adaptersRaw[adapter];
      return;
    }
    const blockObj = block as Record<string, unknown>;
    const hasLegacyShape = ['allow', 'allowed', 'whitelist', 'connections', 'connectionStrings', 'secrets'].some(
      (key) => key in blockObj
    );
    if (hasLegacyShape) {
      normalizedAdapters[adapter] = blockObj;
      return;
    }

    const normalizedBlock: Record<string, unknown> = {};
    Object.entries(blockObj).forEach(([rawKey, value]) => {
      const adapterKey = normalizeAdapterKey(rawKey);
      if (!adapterKey) return;
      if (value === undefined || value === null || value === '') return;

      if (hasReferenceLikeShape(value)) {
        normalizedBlock[adapterKey] = isSqlAdapter(adapter)
          ? normalizeSqlSecretRefShape(value)
          : value;
        return;
      }

      normalizedBlock[adapterKey] = isSqlAdapter(adapter)
        ? buildReadWriteSecretRef(adapter, adapterKey)
        : buildSingleSecretRef(adapter, adapterKey);
    });

    normalizedAdapters[adapter] = normalizedBlock;
  });

  return {
    ...config,
    adapters: normalizedAdapters,
  };
};

export const buildAdapterConfigTemplate = (
  adapterAccess: AdapterAccess,
  secretKeys: string[]
) => {
  const config: Record<string, any> = { adapters: {} as Record<string, any> };
  const secretMap: Record<string, string[]> = {};

  secretKeys.forEach((keyName) => {
    const parsed = parseSecretKeyParts(keyName);
    if (!parsed) return;
    secretMap[parsed.adapter] = secretMap[parsed.adapter] || [];
    if (!secretMap[parsed.adapter].includes(parsed.adapterKey)) {
      secretMap[parsed.adapter].push(parsed.adapterKey);
    }
  });

  ADAPTER_KEYS.forEach((adapter) => {
    const allow = adapterAccess[adapter]?.allow ?? [];
    const keys = new Set<string>([
      ...allow.map((item) => item.toLowerCase()),
      ...(secretMap[adapter] || []),
    ]);
    if (!keys.size) return;

    const block: Record<string, unknown> = {};
    keys.forEach((key) => {
      if (adapter === 'postgres' || adapter === 'mysql' || adapter === 'mssql') {
        block[key] = buildReadWriteSecretRef(adapter, key);
      } else {
        block[key] = buildSingleSecretRef(adapter, key);
      }
    });

    (config.adapters as Record<string, any>)[adapter] = block;
  });

  return JSON.stringify(config, null, 2);
};
