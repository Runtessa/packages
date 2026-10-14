import type { DataSource, QueryRunner } from 'typeorm';
import { RdbmsSchemaBuilder } from 'typeorm/schema-builder/RdbmsSchemaBuilder';

export async function planSchemaOnRunner(source: DataSource, runner: QueryRunner) {
  // The planner borrows the locked connection. Only the caller owns its lifetime.
  const borrowed = new Proxy(runner, {
    get(target, key) {
      if (key === 'release') return async () => undefined;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const connection = new Proxy(source, {
    get(target, key) {
      return key === 'createQueryRunner' ? () => borrowed : Reflect.get(target, key, target);
    },
  });
  return new RdbmsSchemaBuilder(connection).log();
}
