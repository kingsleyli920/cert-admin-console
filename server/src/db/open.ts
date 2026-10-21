import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { seed, seedRows } from './seed';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

// Children first, so deletes never violate a foreign key.
const TABLES_CHILDREN_FIRST = [
  'bulk_issue_run_items',
  'audit_logs',
  'certificates',
  'bulk_issue_runs',
  'enrollments',
  'learners',
  'courses',
  'admin_tenants',
  'admins',
  'tenants',
] as const;

export function openDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  return db;
}

export function migrate(db: DatabaseSync): void {
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
}

export function isEmpty(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM tenants').get() as { n: number };
  return row.n === 0;
}

export function initDatabase(dbPath: string, opts: { seed: boolean }): DatabaseSync {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  try {
    migrate(db);
    if (opts.seed && isEmpty(db)) seed(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/** Wipes every table and re-seeds, atomically: on any error the previous state is kept. */
export function resetDatabase(db: DatabaseSync): void {
  db.exec('BEGIN');
  try {
    for (const table of TABLES_CHILDREN_FIRST) db.exec(`DELETE FROM ${table}`);
    seedRows(db);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
