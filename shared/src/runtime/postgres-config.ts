import { Client } from 'pg';
import { authorizeNetworkTarget } from './network-policy';

/** Validate credentials in the trusted parent before any model or tenant code receives them. */
export async function validateTenantPostgresConfig(value: unknown): Promise<void> {
  for (const item of Array.isArray(value) ? value : [value]) {
    let config: Record<string, any>;
    const uri = typeof item === 'string' ? item : (item as any)?.connectionString || (item as any)?.url;
    if (uri) {
      const url = new URL(uri);
      config = { connectionString: uri, host: url.hostname, port: Number(url.port || 5432) };
    } else if (item && typeof item === 'object') config = { ...item as Record<string, any> };
    else throw new Error('Invalid tenant PostgreSQL configuration');
    const host = String(config.host || '127.0.0.1'), port = Number(config.port || 5432);
    const target = await authorizeNetworkTarget({ host, port });
    if (config.connectionString) {
      const pinned = new URL(config.connectionString); pinned.hostname = target.address.includes(':') ? `[${target.address}]` : target.address;
      config.connectionString = pinned.toString();
    }
    const client = new Client({ ...config, user: config.user || config.username,
      host: target.address, port, connectionTimeoutMillis: 3000, query_timeout: 3000 });
    try {
      await client.connect();
      const result = await client.query(`SELECT EXISTS (
        SELECT 1 FROM pg_roles WHERE pg_has_role(current_user, oid, 'MEMBER') AND
          (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls OR
           rolname IN ('pg_read_all_data','pg_write_all_data','pg_read_server_files','pg_write_server_files','pg_execute_server_program'))
      ) AS elevated`);
      if (result.rows[0].elevated) throw Object.assign(new Error('Tenant database credentials must not have administrative or global data privileges'), { statusCode: 403 });
    } finally { await client.end(); }
  }
}
