import type { PlatformMigration } from '../migration-types';

// Frozen baseline: append a new migration for changes; never regenerate applied history.
export const migration: PlatformMigration = {
  id: "0001_platform_users",
  kind: 'baseline',
  sql: [
    "CREATE TABLE \"users\" (\"id\" SERIAL NOT NULL, \"email\" character varying NOT NULL, \"token\" character varying, \"password_hash\" character varying, \"role\" character varying NOT NULL DEFAULT 'user', \"created_at\" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT \"UQ_97672ac88f789774dd47f7c8be3\" UNIQUE (\"email\"), CONSTRAINT \"PK_a3ffb1c0c8416b9fc6f907b7433\" PRIMARY KEY (\"id\"))",
    "CREATE UNIQUE INDEX \"IDX_7869db61ed722d562da1acf6d5\" ON \"users\" (\"token\") ",
  ],
  tables: [
    {"name":"users","columns":[{"name":"role","type":"character varying","length":"","isNullable":false,"isPrimary":false,"isUnique":false,"isGenerated":false,"default":"'user'","isArray":false},{"name":"created_at","type":"timestamp without time zone","length":"","isNullable":false,"isPrimary":false,"isUnique":false,"isGenerated":false,"default":"now()","isArray":false},{"name":"id","type":"integer","length":"","isNullable":false,"isPrimary":true,"isUnique":false,"isGenerated":true,"generationStrategy":"increment","isArray":false},{"name":"email","type":"character varying","length":"","isNullable":false,"isPrimary":false,"isUnique":true,"isGenerated":false,"isArray":false},{"name":"password_hash","type":"character varying","length":"","isNullable":true,"isPrimary":false,"isUnique":false,"isGenerated":false,"isArray":false},{"name":"token","type":"character varying","length":"","isNullable":true,"isPrimary":false,"isUnique":false,"isGenerated":false,"isArray":false}],"indices":[{"name":"IDX_7869db61ed722d562da1acf6d5","columnNames":["token"],"isUnique":true,"where":"","isSpatial":false,"isFulltext":false}],"uniques":[{"name":"UQ_97672ac88f789774dd47f7c8be3","columnNames":["email"]}],"foreignKeys":[],"checks":[],"exclusions":[]},
  ],
};
