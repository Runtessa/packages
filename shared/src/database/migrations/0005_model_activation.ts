import type { PlatformMigration } from '../migration-types';

export const migration: PlatformMigration = {
  id: '0005_model_activation', kind: 'upgrade', dependencies: ['0003_platform_core'],
  sql: [
    `CREATE TABLE runtessa_model_state (
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      adapter_key text NOT NULL,
      active_models jsonb NOT NULL DEFAULT '[]', active_revision text NOT NULL DEFAULT '',
      pending jsonb, activated_at timestamptz,
      PRIMARY KEY (tenant_id, adapter_key)
    )`,
  ],
  tables: [{
  "name": "runtessa_model_state",
  "columns": [
    {
      "name": "active_revision",
      "type": "text",
      "length": "",
      "isNullable": false,
      "isPrimary": false,
      "isUnique": false,
      "isGenerated": false,
      "default": "''",
      "isArray": false
    },
    {
      "name": "active_models",
      "type": "jsonb",
      "length": "",
      "isNullable": false,
      "isPrimary": false,
      "isUnique": false,
      "isGenerated": false,
      "default": "'[]'",
      "isArray": false
    },
    {
      "name": "adapter_key",
      "type": "text",
      "length": "",
      "isNullable": false,
      "isPrimary": true,
      "isUnique": false,
      "isGenerated": false,
      "isArray": false
    },
    {
      "name": "tenant_id",
      "type": "uuid",
      "length": "",
      "isNullable": false,
      "isPrimary": true,
      "isUnique": false,
      "isGenerated": false,
      "isArray": false
    },
    {
      "name": "activated_at",
      "type": "timestamp with time zone",
      "length": "",
      "isNullable": true,
      "isPrimary": false,
      "isUnique": false,
      "isGenerated": false,
      "isArray": false
    },
    {
      "name": "pending",
      "type": "jsonb",
      "length": "",
      "isNullable": true,
      "isPrimary": false,
      "isUnique": false,
      "isGenerated": false,
      "isArray": false
    }
  ],
  "indices": [],
  "uniques": [],
  "foreignKeys": [
    {
      "name": "runtessa_model_state_tenant_id_fkey",
      "columnNames": [
        "tenant_id"
      ],
      "referencedTableName": "tenants",
      "referencedColumnNames": [
        "id"
      ],
      "onDelete": "CASCADE",
      "onUpdate": "NO ACTION"
    }
  ],
  "checks": [],
  "exclusions": []
}],
};
