import 'dotenv/config';
import { closeDatabase, ensureDatabaseReady } from '../lib/db';

const main = async (): Promise<void> => {
  await ensureDatabaseReady();
  console.log('[auth-service] migrations complete');
};

main()
  .catch((error) => {
    console.error('[auth-service] migration failure', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
