import type { DatabaseSync } from 'node:sqlite';

const SQLITE_CONSTRAINT_UNIQUE = 2067;

/**
 * True for a UNIQUE-constraint violation. `err.code` is `ERR_SQLITE_ERROR` for every SQLite
 * error, so only the extended result code (`errcode`) tells them apart (SPEC §2.6 #2).
 */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { errcode?: unknown }).errcode === SQLITE_CONSTRAINT_UNIQUE;
}

/**
 * Runs `fn` in one transaction. Any error triggers an explicit ROLLBACK (the connection stays
 * inside the failed transaction otherwise) and is rethrown. `fn` must be synchronous: a
 * transaction never spans an await, so concurrent requests cannot interleave statements.
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
