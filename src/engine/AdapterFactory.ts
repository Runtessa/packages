import https from 'https';
import { Pool as PgPool } from 'pg';
import { createPool as createMySqlPool } from 'mysql2/promise';
import { ConnectionPool, config as MssqlConfig } from 'mssql';
import Redis from 'ioredis';
import { Kafka, Producer } from 'kafkajs';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DataSource } from 'typeorm';
import { CircuitBreaker } from '../core/resilience/CircuitBreaker';
import { CryptoService } from '../core/security/CryptoService';
import { Tenant } from '@idp/shared';
import { Secret } from '@idp/shared';
import { CompilerAdapter } from './adapters/CompilerAdapter';

type AsyncFactory<T> = (envKey: string) => Promise<T>;

type ReadWriteFactory<T> = {
  (key: string): Promise<T>;
  readOnly: (key: string) => Promise<T>;
  readWrite: (key: string) => Promise<T>;
};

export interface PostgresAdapter {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
}

export interface MysqlAdapter {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
}

export interface MssqlAdapter {
  query: (sql: string) => Promise<unknown[]>;
}

export interface RedisAdapter {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSeconds?: number) => Promise<'OK'>;
  del: (key: string) => Promise<number>;
  publish: (channel: string, message: string) => Promise<number>;
}

export interface KafkaAdapter {
  publish: (topic: string, messages: { key?: string; value: string }[]) => Promise<void>;
}

export interface S3Adapter {
  putObject: (params: { bucket: string; key: string; body: Buffer | string }) => Promise<void>;
  getSignedUrl: (params: { bucket: string; key: string; expiresIn?: number }) => Promise<string>;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | Record<string, unknown>;
  timeoutMs?: number;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
}

export interface SandboxAdapters {
  postgres: ReadWriteFactory<PostgresAdapter>;
  mysql: ReadWriteFactory<MysqlAdapter>;
  mssql: ReadWriteFactory<MssqlAdapter>;
  redis: AsyncFactory<RedisAdapter>;
  kafka: AsyncFactory<KafkaAdapter>;
  s3: AsyncFactory<S3Adapter>;
  http?: {
    request: (url: string, options?: HttpRequestOptions) => Promise<HttpResponse>;
  };
  compiler?: CompilerAdapter;
}

export class AdapterFactory {
  private pgPools: Map<string, PgPool> = new Map();
  private mysqlPools: Map<string, ReturnType<typeof createMySqlPool>> = new Map();
  private mssqlPools: Map<string, ConnectionPool> = new Map();
  private redisClients: Map<string, Redis> = new Map();
  private kafkaProducers: Map<string, Producer> = new Map();
  private s3Clients: Map<string, S3Client> = new Map();

  private breakers: Map<string, CircuitBreaker> = new Map();
  private compilerAdapter: CompilerAdapter;

  constructor(private readonly dataSource: DataSource, private readonly cryptoService: CryptoService) {
    this.compilerAdapter = new CompilerAdapter();
  }

  build(tenant: Tenant): SandboxAdapters {
    const postgres = ((key: string) => this.buildPostgres(tenant, key, 'write')) as ReadWriteFactory<PostgresAdapter>;
    postgres.readOnly = (key: string) => this.buildPostgres(tenant, key, 'read');
    postgres.readWrite = (key: string) => this.buildPostgres(tenant, key, 'write');

    const mysql = ((key: string) => this.buildMysql(tenant, key, 'write')) as ReadWriteFactory<MysqlAdapter>;
    mysql.readOnly = (key: string) => this.buildMysql(tenant, key, 'read');
    mysql.readWrite = (key: string) => this.buildMysql(tenant, key, 'write');

    const mssql = ((key: string) => this.buildMssql(tenant, key, 'write')) as ReadWriteFactory<MssqlAdapter>;
    mssql.readOnly = (key: string) => this.buildMssql(tenant, key, 'read');
    mssql.readWrite = (key: string) => this.buildMssql(tenant, key, 'write');

    return {
      postgres,
      mysql,
      mssql,
      redis: (envKey) => this.buildRedis(tenant, envKey),
      kafka: (envKey) => this.buildKafka(tenant, envKey),
      s3: (envKey) => this.buildS3(tenant, envKey),
      http: this.buildHttpAdapter(tenant),
      compiler: this.compilerAdapter,
    };
  }

  private breakerFor(key: string): CircuitBreaker {
    let br = this.breakers.get(key);
    if (!br) {
      br = new CircuitBreaker();
      this.breakers.set(key, br);
    }
    return br;
  }

  private async getSecretValue(tenant: Tenant, keyName: string): Promise<string> {
    const repo = this.dataSource.getRepository(Secret);
    let secret = await repo.findOne({ where: { tenant: { id: tenant.id }, keyName } });
    if (!secret) {
      secret = await repo
        .createQueryBuilder('secret')
        .where('secret."keyName" = :keyName', { keyName })
        .andWhere('secret."tenantId" = :tenantId', { tenantId: tenant.id })
        .getOne();
    }
    if (!secret) {
      const rows = await repo.query(
        'select "encryptedValue", "iv", "authTag" from secrets where "tenantId" = $1 and "keyName" = $2 limit 1',
        [tenant.id, keyName],
      );
      if (Array.isArray(rows) && rows[0]) {
        return this.cryptoService.decryptSecret({
          encryptedValue: rows[0].encryptedValue,
          iv: rows[0].iv,
          authTag: rows[0].authTag,
        });
      }
    }
    if (!secret) {
      let debugInfo = '';
      try {
        const result = await repo.query('select current_database() as db');
        const dbName = Array.isArray(result) && result[0]?.db ? result[0].db : 'unknown';
        const countResult = await repo.query(
          'select count(*)::int as count from secrets where "tenantId" = $1',
          [tenant.id],
        );
        const count =
          Array.isArray(countResult) && typeof countResult[0]?.count === 'number'
            ? countResult[0].count
            : Number(countResult[0]?.count ?? 0);
        debugInfo = ` (db=${dbName}, tenantSecrets=${count})`;
      } catch {
        // ignore debug failures
      }
      throw new Error(`Secret ${keyName} not found for tenant${debugInfo}`);
    }
    try {
      return this.cryptoService.decryptSecret({
        encryptedValue: secret.encryptedValue,
        authTag: secret.authTag,
        iv: secret.iv,
      });
    } catch (err) {
      throw new Error(`Secret ${keyName} found but failed to decrypt`);
    }
  }

  private async resolveSecretValue(tenant: Tenant, adapter: string, key: string): Promise<string> {
    const rawKey = key.trim();
    const lowerKey = rawKey.toLowerCase();
    const candidates = [
      `${adapter}:${lowerKey}`,
      `${adapter}:${rawKey}`,
      lowerKey,
      rawKey,
    ];
    for (const candidate of candidates) {
      try {
        return await this.getSecretValue(tenant, candidate);
      } catch (err) {
        if (err instanceof Error && err.message.includes('failed to decrypt')) {
          throw err;
        }
        // try next
      }
    }
    let debugInfo = '';
    try {
      const repo = this.dataSource.getRepository(Secret);
      const result = await repo.query('select current_database() as db');
      const dbName = Array.isArray(result) && result[0]?.db ? result[0].db : 'unknown';
      const countResult = await repo.query(
        'select count(*)::int as count from secrets where "tenantId" = $1',
        [tenant.id],
      );
      const count =
        Array.isArray(countResult) && typeof countResult[0]?.count === 'number'
          ? countResult[0].count
          : Number(countResult[0]?.count ?? 0);
      let keys: string[] = [];
      if (count > 0) {
        const rows = await repo.query(
          'select "keyName" from secrets where "tenantId" = $1',
          [tenant.id],
        );
        keys = Array.isArray(rows) ? rows.map((row) => row.keyName) : [];
      }
      debugInfo = ` (db=${dbName}, tenantSecrets=${count}, keys=${keys.join('|')})`;
    } catch {
      // ignore debug failures
    }
    throw new Error(
      `Secret ${rawKey} not found for tenant ${tenant.id}. Tried keys: ${candidates.join(', ')}${debugInfo}`
    );
  }

  private selectReadWriteConfig(secretVal: string, mode: 'read' | 'write') {
    try {
      const parsed = JSON.parse(secretVal);
      if (!parsed || typeof parsed !== 'object') return secretVal;
      if ('read' in parsed || 'write' in parsed) {
        const readVal = (parsed as any).read;
        const writeVal = (parsed as any).write;
        const selected = mode === 'read' ? (readVal ?? writeVal) : (writeVal ?? readVal);
        if (Array.isArray(selected)) {
          return selected[0] ?? secretVal;
        }
        return selected ?? secretVal;
      }
      return parsed;
    } catch {
      return secretVal;
    }
  }

  private normalizeDbConfig(config: Record<string, unknown>) {
    const normalized = { ...config } as Record<string, unknown>;
    if (!normalized.user && typeof normalized.username === 'string') {
      normalized.user = normalized.username;
    }
    return normalized;
  }

  private ensureAdapterAccess(tenant: Tenant, adapter: string, adapterKey: string) {
    const rawKey = adapterKey.trim();
    const lowerKey = rawKey.toLowerCase();
    const access = tenant.adapterAccess || {};
    const rule = (access as Record<string, { allow?: string[] } | undefined>)[adapter];
    const allow = rule?.allow ?? [];
    if (allow.length === 0) {
      throw new Error(`Access denied: ${adapter} adapter is not enabled for tenant`);
    }
    if (allow.includes('*')) return;
    if (!allow.includes(rawKey) && !allow.includes(lowerKey)) {
      throw new Error(`Access denied: ${adapter} adapter cannot access ${rawKey}`);
    }
  }

  private async buildPostgres(
    tenant: Tenant,
    adapterKey: string,
    mode: 'read' | 'write',
  ): Promise<PostgresAdapter> {
    this.ensureAdapterAccess(tenant, 'postgres', adapterKey);
    const normalizedKey = adapterKey.trim().toLowerCase();
    const cacheKey = `${tenant.id}:pg:${normalizedKey}:${mode}`;
    if (!this.pgPools.has(cacheKey)) {
      const secretVal = await this.resolveSecretValue(tenant, 'postgres', normalizedKey);
      const config = this.selectReadWriteConfig(secretVal, mode);
      if (typeof config === 'string') {
        this.pgPools.set(cacheKey, new PgPool({ connectionString: config }));
      } else {
        this.pgPools.set(cacheKey, new PgPool(this.normalizeDbConfig(config as Record<string, unknown>)));
      }
    }
    const pool = this.pgPools.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      query: async (sql: string, params?: unknown[]) =>
        breaker.fire(async () => {
          const client = await pool.connect();
          try {
            const result = await client.query(sql, params as unknown[] | undefined);
            return result.rows;
          } finally {
            client.release();
          }
        }),
    };
  }

  private async buildMysql(
    tenant: Tenant,
    adapterKey: string,
    mode: 'read' | 'write',
  ): Promise<MysqlAdapter> {
    this.ensureAdapterAccess(tenant, 'mysql', adapterKey);
    const normalizedKey = adapterKey.trim().toLowerCase();
    const cacheKey = `${tenant.id}:mysql:${normalizedKey}:${mode}`;
    if (!this.mysqlPools.has(cacheKey)) {
      const secretVal = await this.resolveSecretValue(tenant, 'mysql', normalizedKey);
      const config = this.selectReadWriteConfig(secretVal, mode);
      if (typeof config === 'string') {
        this.mysqlPools.set(cacheKey, createMySqlPool({ uri: config }));
      } else {
        this.mysqlPools.set(
          cacheKey,
          createMySqlPool(this.normalizeDbConfig(config as Record<string, unknown>)),
        );
      }
    }
    const pool = this.mysqlPools.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      query: async (sql: string, params?: unknown[]) =>
        breaker.fire(async () => {
          const [rows] = await pool.query(sql, params as unknown[] | undefined);
          return Array.isArray(rows) ? rows : [];
        }),
    };
  }

  private async buildMssql(
    tenant: Tenant,
    adapterKey: string,
    mode: 'read' | 'write',
  ): Promise<MssqlAdapter> {
    this.ensureAdapterAccess(tenant, 'mssql', adapterKey);
    const normalizedKey = adapterKey.trim().toLowerCase();
    const cacheKey = `${tenant.id}:mssql:${normalizedKey}:${mode}`;
    if (!this.mssqlPools.has(cacheKey)) {
      const secretVal = await this.resolveSecretValue(tenant, 'mssql', normalizedKey);
      const config = this.selectReadWriteConfig(secretVal, mode);
      const pool =
        typeof config === 'string'
          ? new ConnectionPool(config)
          : new ConnectionPool(
              this.normalizeDbConfig(config as Record<string, unknown>) as unknown as MssqlConfig
            );
      await pool.connect();
      this.mssqlPools.set(cacheKey, pool);
    }
    const pool = this.mssqlPools.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      query: async (sql: string) =>
        breaker.fire(async () => {
          const result = await pool.request().query(sql);
          return result.recordset;
        }),
    };
  }

  private async buildRedis(tenant: Tenant, envKey: string): Promise<RedisAdapter> {
    this.ensureAdapterAccess(tenant, 'redis', envKey);
    const cacheKey = `${tenant.id}:redis:${envKey}`;
    if (!this.redisClients.has(cacheKey)) {
      const secretVal = await this.resolveSecretValue(tenant, 'redis', envKey);
      let config: string | Record<string, unknown> = secretVal;
      try {
        const parsed = JSON.parse(secretVal);
        if (parsed && typeof parsed === 'object') {
          const url = (parsed as any).url;
          config = typeof url === 'string' ? url : (parsed as Record<string, unknown>);
        }
      } catch {
        // use raw string
      }
      this.redisClients.set(cacheKey, new Redis(config as any));
    }
    const client = this.redisClients.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      get: async (key: string) => breaker.fire(async () => client.get(key)),
      set: async (key: string, value: string, ttlSeconds?: number) =>
        breaker.fire(async () => {
          if (ttlSeconds) {
            return client.set(key, value, 'EX', ttlSeconds);
          }
          return client.set(key, value);
        }),
      del: async (key: string) => breaker.fire(async () => client.del(key)),
      publish: async (channel: string, message: string) =>
        breaker.fire(async () => client.publish(channel, message)),
    };
  }

  private async buildKafka(tenant: Tenant, envKey: string): Promise<KafkaAdapter> {
    this.ensureAdapterAccess(tenant, 'kafka', envKey);
    const cacheKey = `${tenant.id}:kafka:${envKey}`;
    if (!this.kafkaProducers.has(cacheKey)) {
      const secretVal = await this.resolveSecretValue(tenant, 'kafka', envKey);
      let brokers: string[] = [];
      try {
        const parsed = JSON.parse(secretVal);
        brokers = parsed.brokers || [];
      } catch {
        brokers = secretVal.split(',').map((s) => s.trim());
      }
      const kafka = new Kafka({ clientId: `tenant-${tenant.id}`, brokers });
      const producer = kafka.producer();
      await producer.connect();
      this.kafkaProducers.set(cacheKey, producer);
    }
    const producer = this.kafkaProducers.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      publish: async (topic: string, messages: { key?: string; value: string }[]) =>
        breaker.fire(async () => {
          await producer.send({
            topic,
            messages: messages.map((m) => ({ key: m.key, value: m.value })),
          });
        }),
    };
  }

  private async buildS3(tenant: Tenant, envKey: string): Promise<S3Adapter> {
    this.ensureAdapterAccess(tenant, 's3', envKey);
    const cacheKey = `${tenant.id}:s3:${envKey}`;
    if (!this.s3Clients.has(cacheKey)) {
      const secretVal = await this.resolveSecretValue(tenant, 's3', envKey);
      let cfg: {
        endpoint?: string;
        region?: string;
        accessKeyId?: string;
        secretAccessKey?: string;
        forcePathStyle?: boolean;
      } = {};
      try {
        cfg = JSON.parse(secretVal);
      } catch {
        cfg = { endpoint: undefined, region: 'us-east-1' };
      }
      const client = new S3Client({
        region: cfg.region || 'us-east-1',
        endpoint: cfg.endpoint,
        forcePathStyle: cfg.forcePathStyle ?? !!cfg.endpoint,
        credentials:
          cfg.accessKeyId && cfg.secretAccessKey
            ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
            : undefined,
      });
      this.s3Clients.set(cacheKey, client);
    }
    const client = this.s3Clients.get(cacheKey)!;
    const breaker = this.breakerFor(cacheKey);
    return {
      putObject: async (params: { bucket: string; key: string; body: Buffer | string }) =>
        breaker.fire(async () => {
          await client.send(
            new PutObjectCommand({
              Bucket: params.bucket,
              Key: params.key,
              Body: params.body,
            }),
          );
        }),
      getSignedUrl: async (params: { bucket: string; key: string; expiresIn?: number }) =>
        breaker.fire(async () => {
          const command = new GetObjectCommand({ Bucket: params.bucket, Key: params.key });
          return getSignedUrl(client, command, { expiresIn: params.expiresIn ?? 900 });
        }),
    };
  }

  private buildHttpAdapter(_tenant: Tenant) {
    const cacheKey = 'http-default';
    const breaker = this.breakerFor(cacheKey);
    return {
      request: async (url: string, options?: HttpRequestOptions): Promise<HttpResponse> =>
        breaker.fire(
          () =>
            new Promise<HttpResponse>((resolve, reject) => {
              const parsedUrl = new URL(url);
              const headers: Record<string, string> = { ...(options?.headers ?? {}) };

              const body =
                options?.body && typeof options.body === 'object' && !(options.body instanceof Buffer)
                  ? JSON.stringify(options.body)
                  : (options?.body as string | Buffer | undefined);

              if (body && !headers['content-length']) {
                headers['content-length'] = Buffer.byteLength(body).toString();
              }

              if (body && !headers['content-type'] && typeof options?.body === 'object') {
                headers['content-type'] = 'application/json';
              }

              const requestOptions: https.RequestOptions = {
                method: options?.method ?? 'GET',
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || 443,
                path: `${parsedUrl.pathname}${parsedUrl.search}`,
                headers,
              };

              const req = https.request(requestOptions, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                  resolve({
                    statusCode: res.statusCode ?? 0,
                    headers: res.headers as Record<string, string | string[]>,
                    body: Buffer.concat(chunks).toString('utf8'),
                  });
                });
              });

              req.on('error', reject);

              req.setTimeout(options?.timeoutMs ?? 5000, () => {
                req.destroy(new Error('HTTP request timed out'));
              });

              if (body) {
                req.write(body);
              }
              req.end();
            }),
        ),
    };
  }
}
