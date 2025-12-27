import https from 'https';
import { Pool as PgPool } from 'pg';
import { createPool as createMySqlPool } from 'mysql2/promise';
import { ConnectionPool } from 'mssql';
import Redis from 'ioredis';
import { Kafka, Producer } from 'kafkajs';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DataSource } from 'typeorm';
import { CircuitBreaker } from '../core/resilience/CircuitBreaker';
import { CryptoService } from '../core/security/CryptoService';
import { Tenant } from '../entities/Tenant';
import { Secret } from '../entities/Secret';
import { CompilerAdapter } from './adapters/CompilerAdapter';

type AsyncFactory<T> = (envKey: string) => Promise<T>;

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
  postgres: AsyncFactory<PostgresAdapter>;
  mysql: AsyncFactory<MysqlAdapter>;
  mssql: AsyncFactory<MssqlAdapter>;
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
    return {
      postgres: (envKey) => this.buildPostgres(tenant, envKey),
      mysql: (envKey) => this.buildMysql(tenant, envKey),
      mssql: (envKey) => this.buildMssql(tenant, envKey),
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
    const secret = await repo.findOne({ where: { tenant: { id: tenant.id }, keyName } });
    if (!secret) {
      throw new Error(`Secret ${keyName} not found for tenant`);
    }
    return this.cryptoService.decryptSecret({
      encryptedValue: secret.encryptedValue,
      authTag: secret.authTag,
      iv: secret.iv,
    });
  }

  private async buildPostgres(tenant: Tenant, envKey: string): Promise<PostgresAdapter> {
    const cacheKey = `${tenant.id}:pg:${envKey}`;
    if (!this.pgPools.has(cacheKey)) {
      const connString = await this.getSecretValue(tenant, envKey);
      this.pgPools.set(cacheKey, new PgPool({ connectionString: connString }));
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

  private async buildMysql(tenant: Tenant, envKey: string): Promise<MysqlAdapter> {
    const cacheKey = `${tenant.id}:mysql:${envKey}`;
    if (!this.mysqlPools.has(cacheKey)) {
      const connString = await this.getSecretValue(tenant, envKey);
      this.mysqlPools.set(cacheKey, createMySqlPool({ uri: connString }));
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

  private async buildMssql(tenant: Tenant, envKey: string): Promise<MssqlAdapter> {
    const cacheKey = `${tenant.id}:mssql:${envKey}`;
    if (!this.mssqlPools.has(cacheKey)) {
      const connString = await this.getSecretValue(tenant, envKey);
      const pool = new ConnectionPool(connString);
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
    const cacheKey = `${tenant.id}:redis:${envKey}`;
    if (!this.redisClients.has(cacheKey)) {
      const connString = await this.getSecretValue(tenant, envKey);
      this.redisClients.set(cacheKey, new Redis(connString));
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
    const cacheKey = `${tenant.id}:kafka:${envKey}`;
    if (!this.kafkaProducers.has(cacheKey)) {
      const secretVal = await this.getSecretValue(tenant, envKey);
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
    const cacheKey = `${tenant.id}:s3:${envKey}`;
    if (!this.s3Clients.has(cacheKey)) {
      const secretVal = await this.getSecretValue(tenant, envKey);
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
