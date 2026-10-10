import type { SchemaSnapshot } from './schema-snapshot';

export type PlatformSchema = 'core' | 'ide' | 'catalog';
export interface PlatformMigration {
  id: string;
  kind: 'baseline' | 'upgrade';
  dependencies?: readonly string[];
  sql: readonly string[];
  tables: readonly SchemaSnapshot[];
}
