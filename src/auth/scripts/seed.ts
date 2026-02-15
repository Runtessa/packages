import 'dotenv/config';
import { closeDatabase, ensureDatabaseReady } from '../lib/db';
import { bootstrapAuthDefaults } from '../lib/services/bootstrap';

const main = async (): Promise<void> => {
  await ensureDatabaseReady();
  await bootstrapAuthDefaults();
};

main()
  .catch((error) => {
    console.error('[auth-service] seed failure', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
