import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDatabase, isEmpty, migrate, openDatabase, resetDatabase } from '../../src/db/open';
import { seed } from '../../src/db/seed';

function scalar(db: DatabaseSync, sql: string): unknown {
  const row = db.prepare(sql).get() as Record<string, unknown>;
  return Object.values(row)[0];
}

const count = (db: DatabaseSync, table: string): number =>
  scalar(db, `SELECT COUNT(*) FROM ${table}`) as number;

describe('openDatabase', () => {
  let dir: string;
  const open: DatabaseSync[] = [];
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-open-'));
  });
  afterEach(() => {
    for (const db of open.splice(0)) if (db.isOpen) db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const track = (db: DatabaseSync): DatabaseSync => {
    open.push(db);
    return db;
  };

  it('enables foreign keys and a busy timeout on a file database', () => {
    const db = track(openDatabase(path.join(dir, 'a.db')));
    expect(scalar(db, 'PRAGMA foreign_keys')).toBe(1);
    expect(scalar(db, 'PRAGMA busy_timeout')).toBe(5000);
  });

  it('uses WAL journal mode for a file database', () => {
    const db = track(openDatabase(path.join(dir, 'a.db')));
    expect(scalar(db, 'PRAGMA journal_mode')).toBe('wal');
  });

  it('keeps an in-memory database out of WAL mode but with foreign keys on', () => {
    const db = track(openDatabase(':memory:'));
    expect(scalar(db, 'PRAGMA journal_mode')).toBe('memory');
    expect(scalar(db, 'PRAGMA foreign_keys')).toBe(1);
  });

  it('rejects dangling foreign keys once migrated', () => {
    const db = track(openDatabase(':memory:'));
    migrate(db);
    expect(() =>
      db.exec("INSERT INTO admin_tenants (admin_id, tenant_id) VALUES ('ghost', 99)"),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('migrate / isEmpty', () => {
  it('creates all tables and is idempotent', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    migrate(db);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toEqual([
      'admin_tenants',
      'admins',
      'audit_logs',
      'bulk_issue_run_items',
      'bulk_issue_runs',
      'certificates',
      'courses',
      'enrollments',
      'learners',
      'tenants',
    ]);
    db.close();
  });

  it('reports empty until tenants exist', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(isEmpty(db)).toBe(true);
    seed(db);
    expect(isEmpty(db)).toBe(false);
    db.close();
  });
});

describe('initDatabase', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-init-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('creates missing parent directories, migrates and seeds', () => {
    const file = path.join(dir, 'nested', 'deeper', 'app.db');
    const db = initDatabase(file, { seed: true });
    expect(fs.existsSync(file)).toBe(true);
    expect(count(db, 'tenants')).toBe(4);
    expect(count(db, 'certificates')).toBe(8000 + 45 + 15);
    db.close();
  });

  it('seeds only when empty: a second call does not duplicate rows', () => {
    const file = path.join(dir, 'app.db');
    initDatabase(file, { seed: true }).close();
    const again = initDatabase(file, { seed: true });
    expect(count(again, 'tenants')).toBe(4);
    expect(count(again, 'certificates')).toBe(8060);
    again.close();
  });

  it('does not seed when seed is false', () => {
    const db = initDatabase(path.join(dir, 'app.db'), { seed: false });
    expect(isEmpty(db)).toBe(true);
    db.close();
  });

  it('works for :memory: without touching the filesystem', () => {
    const db = initDatabase(':memory:', { seed: true });
    expect(count(db, 'tenants')).toBe(4);
    db.close();
  });
});

describe('resetDatabase', () => {
  it('restores seeded state after mutations, including new rows in every table', () => {
    const db = initDatabase(':memory:', { seed: true });
    db.exec("DELETE FROM audit_logs WHERE certificate_id = 1");
    db.exec('DELETE FROM certificates WHERE id = 1');
    db.exec("UPDATE tenants SET next_serial = 999 WHERE id = 1");
    db.exec(
      "INSERT INTO bulk_issue_runs (tenant_id, course_id, idempotency_key, created_by, created_at, status) VALUES (1, 101, 'k', 'alice', '2026-01-01T00:00:00.000Z', 'running')",
    );
    expect(count(db, 'certificates')).toBe(8059);

    resetDatabase(db);

    expect(count(db, 'certificates')).toBe(8060);
    expect(count(db, 'bulk_issue_runs')).toBe(0);
    expect(scalar(db, 'SELECT next_serial FROM tenants WHERE id = 1')).toBe(46);
    expect(db.isTransaction).toBe(false);
    db.close();
  });

  it('rolls back everything and rethrows when re-seeding fails', () => {
    const db = initDatabase(':memory:', { seed: true });
    db.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON courses BEGIN SELECT RAISE(ABORT, 'seed exploded'); END",
    );
    db.exec('DELETE FROM audit_logs WHERE certificate_id = 1');

    expect(() => resetDatabase(db)).toThrow(/seed exploded/);

    // Nothing was deleted by the failed reset, and the mutation made before it survives.
    expect(db.isTransaction).toBe(false);
    expect(count(db, 'tenants')).toBe(4);
    expect(count(db, 'certificates')).toBe(8060);
    expect(count(db, 'audit_logs')).toBe(8145 - 1); // 8060 ISSUE + 85 REVOKE, minus the deleted row
    db.close();
  });
});
