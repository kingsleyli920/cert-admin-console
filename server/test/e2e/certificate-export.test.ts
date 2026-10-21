// CSV export over a real server process with a FILE database (SPEC §2.6 #4, §3.1 L3, §3.3 Export).
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bulkIssueRunResponseSchema, CSV_BOM } from '@cac/shared';
import { parseCsv } from '../helpers/csv';
import { startRealServer, type RealServer } from '../helpers/real-server';

let server: RealServer;
const cookies: Record<string, string> = {};
beforeAll(async () => {
  server = await startRealServer();
  for (const adminId of ['alice', 'bob']) {
    const res = await fetch(`${server.url}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminId }),
    });
    expect(res.status).toBe(204);
    cookies[adminId] = (res.headers.get('set-cookie') ?? '').split(';')[0];
  }
});
afterAll(() => server.stop());

const exportPath = (tid: number, query = '') => `/api/tenants/${tid}/certificates/export.csv${query ? `?${query}` : ''}`;

/** Body as UTF-8 text with the BOM kept (`res.text()` would strip it). */
async function bodyText(res: Response): Promise<string> {
  return Buffer.from(await res.arrayBuffer()).toString('utf8');
}

/** Whole export as parsed records (BOM stripped; the BOM itself is asserted by callers that care). */
async function fetchRows(tid: number, admin: string, query = ''): Promise<string[][]> {
  const res = await fetch(server.url + exportPath(tid, query), { headers: { cookie: cookies[admin] } });
  expect(res.status).toBe(200);
  const text = await bodyText(res);
  expect(text.startsWith(CSV_BOM)).toBe(true);
  return parseCsv(text.slice(1));
}

/** Opens an export and hands back the first chunk with the response paused, so the server is mid-stream. */
function startExport(tid: number, admin: string, query = '') {
  return new Promise<{
    res: http.IncomingMessage;
    firstChunk: Buffer;
    finish: () => Promise<string>;
    abort: () => void;
  }>((resolve, reject) => {
    const req = http.get(server.url + exportPath(tid, query), { headers: { cookie: cookies[admin] } }, (res) => {
      const chunks: Buffer[] = [];
      let done: Promise<string> | undefined;
      res.once('data', (first: Buffer) => {
        res.pause();
        chunks.push(first);
        resolve({
          res,
          firstChunk: first,
          abort: () => req.destroy(),
          finish: () => {
            done ??= new Promise<string>((ok, fail) => {
              res.on('data', (c: Buffer) => chunks.push(c));
              res.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
              res.on('error', fail);
              res.resume();
            });
            return done;
          },
        });
      });
    });
    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
    });
  });
}

describe('LCL export at scale', () => {
  it('streams 8000 rows plus the header, chunked, in under 3 seconds', async () => {
    const started = performance.now();
    const res = await fetch(server.url + exportPath(3), { headers: { cookie: cookies.bob } });
    const text = await bodyText(res);
    const elapsed = performance.now() - started;

    expect(res.status).toBe(200);
    expect(res.headers.get('transfer-encoding')).toBe('chunked');
    expect(res.headers.get('content-length')).toBeNull();
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="certificates-LCL-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    const [head, ...rows] = parseCsv(text.slice(1));
    expect(head).toEqual(['Learner Name', 'Course Title', 'Serial Number', 'Issue Date (Australia/Sydney)']);
    expect(rows).toHaveLength(8000);
    expect(new Set(rows.map((r) => r[2])).size).toBe(8000);
    expect(elapsed).toBeLessThan(3000);
  });

  it('another tenant\'s admin gets 404, not the file', async () => {
    const res = await fetch(server.url + exportPath(3), { headers: { cookie: cookies.alice } });
    expect(res.status).toBe(404);
    await res.arrayBuffer();
  });
});

describe('abort', () => {
  it('a client that disconnects mid-stream does not hurt the server', async () => {
    const partial = await startExport(3, 'bob');
    partial.abort();
    await new Promise((r) => setTimeout(r, 100));
    expect((await fetch(`${server.url}/api/health`)).status).toBe(200);
    expect(await fetchRows(3, 'bob')).toHaveLength(8001);
  });
});

describe('snapshot consistency (HHT, with filler so the file outgrows the socket buffers)', () => {
  const FILLER = 100_000;
  const BASE_VALID = 42; // HHT seed: 45 certificates, 3 revoked
  const REVOKED_ID = 2;

  beforeAll(() => {
    const db = new DatabaseSync(server.dbPath);
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('BEGIN');
    const learner = db.prepare("INSERT INTO learners (id, tenant_id, name, email, status) VALUES (?, 1, ?, 'f@example.com', 'active')");
    const cert = db.prepare(
      `INSERT INTO certificates (id, tenant_id, course_id, learner_id, serial, issued_at, issued_by, status)
       VALUES (?, 1, 102, ?, ?, '2026-01-01T00:00:00.000Z', 'alice', 'valid')`,
    );
    for (let i = 1; i <= FILLER; i++) {
      learner.run(500_000 + i, `Filler Learner ${i}`);
      cert.run(500_000 + i, 500_000 + i, `HHT-FILL-${String(i).padStart(6, '0')}`);
    }
    db.exec('COMMIT');
    db.close();
  }, 60_000);

  async function bulkIssueFireSafety(): Promise<void> {
    const post = await fetch(`${server.url}/api/tenants/1/courses/101/bulk-issue`, {
      method: 'POST',
      headers: { cookie: cookies.alice, 'idempotency-key': randomUUID() },
    });
    expect(post.status).toBe(202);
    const runId = bulkIssueRunResponseSchema.parse(await post.json()).run.id;
    for (let i = 0; i < 400; i++) {
      const res = await fetch(`${server.url}/api/tenants/1/bulk-issue-runs/${runId}`, { headers: { cookie: cookies.alice } });
      if (bulkIssueRunResponseSchema.parse(await res.json()).run.status === 'completed') return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('bulk issue run did not complete');
  }

  it('an export keeps the state of its start while a revoke and a bulk issue commit mid-stream', async () => {
    const detail = await fetch(`${server.url}/api/tenants/1/certificates/${REVOKED_ID}`, { headers: { cookie: cookies.alice } });
    const { serial: revokedSerial } = (await detail.json()) as { serial: string };

    // Oldest first: the filler is streamed first, so the revoked and the 8 new rows are still ahead of the cursor.
    const live = await startExport(1, 'alice', 'status=valid&sort=issuedAt&order=asc');
    expect(live.firstChunk.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 200)); // the server is now blocked on backpressure, mid-stream

    // Both writes commit while the export is still being streamed.
    const revoke = await fetch(`${server.url}/api/tenants/1/certificates/${REVOKED_ID}/revoke`, {
      method: 'POST',
      headers: { cookie: cookies.alice, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Issued in error' }),
    });
    expect(revoke.status).toBe(200);
    await bulkIssueFireSafety();

    const text = await live.finish();
    expect(text.startsWith(CSV_BOM)).toBe(true);
    const [, ...snapshot] = parseCsv(text.slice(1));
    expect(snapshot).toHaveLength(BASE_VALID + FILLER); // no +8 from the run
    expect(snapshot.some((r) => r[2] === revokedSerial)).toBe(true); // revoked after the export began

    // A later export sees both changes: 8 issued, 1 revoked.
    const after = await fetchRows(1, 'alice', 'status=valid');
    expect(after).toHaveLength(1 + BASE_VALID + FILLER + 8 - 1);
    expect(after.some((r) => r[2] === revokedSerial)).toBe(false);
    expect(await fetchRows(1, 'alice')).toHaveLength(1 + 45 + FILLER + 8);
  }, 60_000);
});
