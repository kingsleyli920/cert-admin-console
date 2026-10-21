import type { DatabaseSync } from 'node:sqlite';
import { migrate, openDatabase } from '../../src/db/open';
import { seed } from '../../src/db/seed';

/** A fresh in-memory database: migrated and seeded. Every call is isolated. */
export function createTestDb(): DatabaseSync {
  const db = openDatabase(':memory:');
  migrate(db);
  seed(db);
  return db;
}
