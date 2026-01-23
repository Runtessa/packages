import { ensureAppInitialized } from './lib/init.js';

ensureAppInitialized()
  .then(() => {
    console.log('Application initialized.');
  })
  .catch((err) => {
    console.error('Failed to initialize application', err);
    process.exit(1);
  });
