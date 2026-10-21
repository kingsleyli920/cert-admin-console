import { DatabaseSync } from 'node:sqlite';

export interface ExportConnection {
  db: DatabaseSync;
  /** Ends the snapshot and closes the dedicated connection. Idempotent; never touches the shared one. */
  close(): void;
}

/**
 * Connection for one streaming export.
 *
 * The app shares a single `DatabaseSync` that bulk-issue runners and revokes write to, and an
 * export can stream for seconds while they do. Reading through that connection would let those
 * writes show up mid-file (a half-old, half-new CSV). So for a FILE database the export gets its
 * OWN read-only connection and a `BEGIN` plus a first read pins one WAL snapshot: every row of
 * the file reflects the database as of the start of the export, and writers are never blocked.
 *
 * Callers must `close()` in a `finally` (it also runs when the client aborts and the stream is
 * destroyed), otherwise the snapshot would hold back WAL checkpoints.
 *
 * For `:memory:` (tests) there is no file to reopen — a second connection would see an empty
 * database — so the shared connection is returned as is and `close()` is a no-op.
 */
export function openExportConnection(shared: DatabaseSync, dbPath: string | undefined): ExportConnection {
  if (dbPath === undefined || dbPath === ':memory:' || dbPath === '') {
    return { db: shared, close: () => {} };
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('BEGIN');
    // A deferred BEGIN only takes its snapshot at the first read; do it now, not lazily.
    db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();
  } catch (err) {
    db.close();
    throw err;
  }
  return {
    db,
    close() {
      if (!db.isOpen) return;
      try {
        if (db.isTransaction) db.exec('ROLLBACK'); // read-only: nothing to commit, just end the snapshot
      } finally {
        db.close();
      }
    },
  };
}
