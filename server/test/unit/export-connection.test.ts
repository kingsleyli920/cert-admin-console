import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase, openDatabase } from '../../src/db/open';
import { openExportConnection } from '../../src/db/export-connection';

const count = (db: DatabaseSync, where = '1'): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM certificates WHERE ${where}`).get() as { n: number }).n;

describe('openExportConnection', () => {
  let dir: string;
  let main: DatabaseSync;
  let dbPath: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-export-conn-'));
    dbPath = path.join(dir, 'app.db');
    main = initDatabase(dbPath, { seed: true });
  });
  afterEach(() => {
    if (main.isOpen) main.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens its own read-only connection for a file database', () => {
    const conn = openExportConnection(main, dbPath);
    try {
      expect(conn.db).not.toBe(main);
      expect(() => conn.db.exec('DELETE FROM certificates')).toThrow(/readonly/i);
    } finally {
      conn.close();
    }
  });

  it('keeps one snapshot: writes committed on the shared connection stay invisible until close', () => {
    const conn = openExportConnection(main, dbPath);
    const valid = "status = 'valid'";
    const before = count(main, valid);
    expect(count(conn.db, valid)).toBe(before);

    main.exec(
      "UPDATE certificates SET status = 'revoked', revoked_at = issued_at, revoked_by = 'alice', revoke_reason = 'x' WHERE id = 2",
    );
    expect(count(main, valid)).toBe(before - 1);
    expect(count(conn.db, valid)).toBe(before); // still the snapshot taken at open

    conn.close();
    expect(conn.db.isOpen).toBe(false);
  });

  it('close is idempotent and never closes the shared connection', () => {
    const conn = openExportConnection(main, dbPath);
    conn.close();
    conn.close();
    expect(main.isOpen).toBe(true);
    expect(count(main)).toBeGreaterThan(0);
  });

  it('falls back to the shared connection for :memory: (a second connection would see an empty database)', () => {
    const mem = openDatabase(':memory:');
    try {
      expect(openExportConnection(mem, ':memory:').db).toBe(mem);
      expect(openExportConnection(mem, undefined).db).toBe(mem);
      const conn = openExportConnection(mem, undefined);
      conn.close();
      expect(mem.isOpen).toBe(true);
    } finally {
      mem.close();
    }
  });
});
