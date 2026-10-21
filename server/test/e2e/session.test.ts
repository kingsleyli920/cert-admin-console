import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminsResponseSchema, errorResponseSchema, meResponseSchema } from '@cac/shared';
import { startRealServer, type RealServer } from '../helpers/real-server';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Signs in over real HTTP and returns the `cookie` header value taken from Set-Cookie. */
async function signIn(server: RealServer, adminId: string): Promise<string> {
  const res = await fetch(`${server.url}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adminId }),
  });
  expect(res.status).toBe(204);
  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);
  return setCookie.split(';')[0];
}

describe('session over a real server process', () => {
  let server: RealServer;
  beforeAll(async () => {
    server = await startRealServer();
  });
  afterAll(() => server.stop());

  it('creates and seeds the database file on first start', () => {
    expect(fs.existsSync(server.dbPath)).toBe(true);
    const db = new DatabaseSync(server.dbPath, { readOnly: true });
    const row = db.prepare('SELECT COUNT(*) AS n FROM certificates').get() as { n: number };
    db.close();
    expect(row.n).toBe(8060);
  });

  it('lists admins, then lets alice use her cookie for /api/me', async () => {
    const admins = adminsResponseSchema.parse(await (await fetch(`${server.url}/api/admins`)).json());
    expect(admins.items.map((a) => a.id)).toEqual(['alice', 'bob', 'carol']);

    const cookie = await signIn(server, 'alice');
    const res = await fetch(`${server.url}/api/me`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const me = meResponseSchema.parse(await res.json());
    expect(me.admin.id).toBe('alice');
    expect(me.tenants.map((t) => t.code)).toEqual(['HHT', 'SRA', 'NHI']);
  });

  it('rejects /api/me without a cookie', async () => {
    const res = await fetch(`${server.url}/api/me`);
    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it("shows bob only his own tenant and no route exposes alice's tenant 1 to him", async () => {
    const cookie = await signIn(server, 'bob');
    const me = meResponseSchema.parse(await (await fetch(`${server.url}/api/me`, { headers: { cookie } })).json());
    expect(me.tenants.map((t) => t.id)).toEqual([3]);

    const res = await fetch(`${server.url}/api/tenants/1/certificates`, { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('restores seeded data through /api/__test__/reset (the process runs with APP_ENV=test)', async () => {
    const db = new DatabaseSync(server.dbPath);
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('DELETE FROM audit_logs WHERE certificate_id = 45');
    db.exec('DELETE FROM certificates WHERE id = 45');
    db.close();

    const res = await fetch(`${server.url}/api/__test__/reset`, { method: 'POST' });
    expect(res.status).toBe(204);

    const check = new DatabaseSync(server.dbPath, { readOnly: true });
    const row = check.prepare('SELECT serial FROM certificates WHERE id = 45').get();
    check.close();
    expect(row).toEqual({ serial: 'HHT-2026-000037' });
  });
});

describe('npm run db:reset', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cac-dbreset-'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('replaces the database file with a freshly seeded one and removes WAL leftovers', async () => {
    const dbPath = path.join(dir, 'app.db');
    const stale = new DatabaseSync(dbPath);
    stale.exec('CREATE TABLE junk (x)');
    stale.close();
    fs.writeFileSync(`${dbPath}-wal`, 'stale');
    fs.writeFileSync(`${dbPath}-shm`, 'stale');

    await promisify(execFile)(process.execPath, ['--import', 'tsx', 'server/src/db/reset-cli.ts'], {
      cwd: repoRoot,
      env: { ...process.env, DB_PATH: dbPath },
    });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'junk'").all();
    const certs = db.prepare('SELECT COUNT(*) AS n FROM certificates').get() as { n: number };
    db.close();
    expect(tables).toEqual([]);
    expect(certs.n).toBe(8060);
  });
});
