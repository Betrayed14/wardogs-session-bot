import { join } from 'node:path';
import { Store } from './store.js';
import { backupDirectory, databasePath } from './config.js';

const store = new Store(databasePath());
try {
  const target = join(backupDirectory(), `manual-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  await store.backupTo(target); console.log(`Backup saved: ${target}`);
} finally { store.close(); }
