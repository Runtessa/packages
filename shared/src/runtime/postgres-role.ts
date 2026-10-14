import type { QueryRunner } from 'typeorm';

export async function assertTenantDatabaseRole(runner: QueryRunner) {
  const [role] = await runner.query(`SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
    FROM pg_roles WHERE rolname = current_user`);
  if (!role || Object.values(role).some((value) => value === true))
    throw Object.assign(new Error('Tenant adapters require a role without administrative database privileges'), { statusCode: 403 });
}
