import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DataSource } from 'typeorm';
import { config } from '../config';

const checksum = (raw: Buffer): string => crypto.createHash('sha256').update(raw).digest('hex');

export const runSqlMigrations = async (dataSource: DataSource): Promise<void> => {
  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await fs.readdir(config.migrationDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const migrationPath = path.join(config.migrationDir, file);
    const raw = await fs.readFile(migrationPath);
    const fileChecksum = checksum(raw);

    const existing: Array<{ checksum: string }> = await dataSource.query(
      'SELECT checksum FROM schema_migrations WHERE filename = $1 LIMIT 1',
      [file],
    );

    if (existing.length > 0) {
      if (existing[0].checksum !== fileChecksum) {
        throw new Error(`Migration checksum mismatch for ${file}`);
      }
      continue;
    }

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.startTransaction();
      await queryRunner.query(raw.toString('utf8'));
      await queryRunner.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [file, fileChecksum],
      );
      await queryRunner.commitTransaction();
      console.log(`[auth-service] applied migration ${file}`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
};
