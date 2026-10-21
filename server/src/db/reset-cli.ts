import fs from 'node:fs';
import { loadConfig } from '../config';
import { initDatabase } from './open';

/** `npm run db:reset`: delete the dev database (and its WAL files) and recreate it seeded. */
const { dbPath } = loadConfig();
for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  fs.rmSync(file, { force: true });
}
initDatabase(dbPath, { seed: true }).close();
console.log(`Database reset and seeded: ${dbPath}`);
