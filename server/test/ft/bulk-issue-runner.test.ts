// Runner behaviour beyond the acceptance file: fault isolation, restart resume, NHI (Brisbane),
// and agreement between the course preview and a run.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { bulkIssueRunResponseSchema, coursesResponseSchema, type BulkIssueRun } from '@cac/shared';
import { migrate, openDatabase } from '../../src/db/open';
import { SEED_IDS, seed } from '../../src/db/seed';
import { classifyEnrollment } from '../../src/modules/bulk-issue/classify';
import { getRunView } from '../../src/modules/bulk-issue/repo';
import { buildTestApp, signIn } from '../helpers/app';
import { createTestDb } from '../helpers/db';

const HHT = SEED_IDS.tenants.hht;
const NHI = SEED_IDS.tenants.nhi;
const FIRE = SEED_IDS.courses.fireSafety2026;
const FS = SEED_IDS.learners.fireSafety;
const NOW = '2026-10-20T01:00:00.000Z';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
async function start(overrides: Parameters<typeof buildTestApp>[0] = {}) {
  const app = await buildTestApp({ now: () => new Date(NOW), ...overrides });
  apps.push(app);
  return app;
}

async function startRun(app: FastifyInstance, cookie: string, tid: number, cid: number): Promise<BulkIssueRun> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/tenants/${tid}/courses/${cid}/bulk-issue`,
    headers: { cookie, 'idempotency-key': randomUUID() },
  });
  expect(res.statusCode).toBe(202);
  return bulkIssueRunResponseSchema.parse(res.json()).run;
}
async function until<T>(read: () => T, done: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 600; i++) {
    const v = read();
    if (done(v)) return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('condition not reached');
}
const completed = (db: DatabaseSync, tid: number, runId: number) =>
  until(() => getRunView(db, tid, runId)!, (r) => r.status === 'completed');
const scalar = (db: DatabaseSync, sql: string, ...p: number[]) => (db.prepare(sql).get(...p) as { n: number }).n;

describe('internal_error path', () => {
  it('fails only the faulty learner and leaves no certificate, audit row or consumed serial', async () => {
    const broken = FS.completedNoCert[2];
    const app = await start({
      faults: {
        beforeIssue: (learnerId) => {
          if (learnerId === broken) throw new Error('injected');
        },
      },
    });
    const alice = await signIn(app, 'alice');
    const run = await completed(app.db, HHT, (await startRun(app, alice, HHT, FIRE)).id);

    expect(run.counts).toEqual({ issued: 7, skipped: 7, failed: 2, pending: 0 });
    expect(run.items.find((i) => i.learnerId === broken)).toMatchObject({
      outcome: 'failed',
      reason: 'internal_error',
      certificateId: null,
      serial: null,
    });
    expect(scalar(app.db, 'SELECT COUNT(*) AS n FROM certificates WHERE course_id = ? AND learner_id = ?', FIRE, broken)).toBe(0);
    expect(scalar(app.db, 'SELECT COUNT(*) AS n FROM audit_logs WHERE course_id = ? AND learner_id = ?', FIRE, broken)).toBe(0);
    // 7 serials were issued contiguously; the failed attempt did not burn a number.
    const serials = run.items.filter((i) => i.outcome === 'issued').map((i) => i.serial).sort();
    expect(serials).toEqual([46, 47, 48, 49, 50, 51, 52].map((n) => `HHT-2026-0000${n}`));
    expect(scalar(app.db, 'SELECT next_serial AS n FROM tenants WHERE id = ?', HHT)).toBe(53);
  });
});

describe('losing the race to another run', () => {
  it('rolls back, keeps the serial counter and skips as already_issued pointing at the winner', async () => {
    // A second connection plays "another run" that commits a certificate after this item
    // read its facts; the unique violation then comes from the item's own INSERT (2067).
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cac-race-'));
    const db = openDatabase(path.join(dir, 'race.db'));
    migrate(db);
    seed(db);
    const other = openDatabase(path.join(dir, 'race.db'));
    const loser = FS.completedNoCert[0];
    let winnerId = 0;
    try {
      const app = await start({
        db,
        faults: {
          beforeIssue: (learnerId) => {
            if (learnerId !== loser) return;
            winnerId = Number(
              other
                .prepare(
                  `INSERT INTO certificates (tenant_id, course_id, learner_id, serial, issued_at, issued_by, status)
                   VALUES (?, ?, ?, 'HHT-2026-999999', ?, 'carol', 'valid')`,
                )
                .run(HHT, FIRE, learnerId, NOW).lastInsertRowid,
            );
            throw Object.assign(new Error('UNIQUE constraint failed'), { errcode: 2067 });
          },
        },
      });
      const alice = await signIn(app, 'alice');
      const run = await completed(db, HHT, (await startRun(app, alice, HHT, FIRE)).id);
      expect(run.items.find((i) => i.learnerId === loser)).toMatchObject({
        outcome: 'skipped',
        reason: 'already_issued',
        certificateId: winnerId,
        serial: 'HHT-2026-999999',
      });
      expect(run.counts).toEqual({ issued: 7, skipped: 8, failed: 1, pending: 0 });
      expect(scalar(db, 'SELECT next_serial AS n FROM tenants WHERE id = ?', HHT)).toBe(53); // 7 issued, none burnt
      expect(scalar(db, "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'ISSUE' AND run_id = ?", run.id)).toBe(7);
    } finally {
      await Promise.all(apps.splice(0).map((a) => a.close()));
      other.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a unique violation with no certificate behind it (e.g. a serial clash) is an internal_error', async () => {
    const app = await start({
      faults: {
        beforeIssue: (learnerId) => {
          if (learnerId === FS.completedNoCert[0]) throw Object.assign(new Error('UNIQUE'), { errcode: 2067 });
        },
      },
    });
    const alice = await signIn(app, 'alice');
    const run = await completed(app.db, HHT, (await startRun(app, alice, HHT, FIRE)).id);
    expect(run.items.find((i) => i.learnerId === FS.completedNoCert[0])).toMatchObject({ outcome: 'failed', reason: 'internal_error' });
  });
});

describe('restart resume (SPEC §2.3 P2)', () => {
  it('a new app on the same database finishes a run that was interrupted mid-way', async () => {
    const db = createTestDb();
    const first = await buildTestApp({ db, delayMs: 60_000, now: () => new Date(NOW) });
    const alice = await signIn(first, 'alice');
    const created = await startRun(first, alice, HHT, FIRE);
    await until(() => getRunView(db, HHT, created.id)!, (r) => r.processed >= 1);

    const closing = performance.now();
    await first.close(); // must not wait for the 60 s pause
    expect(performance.now() - closing).toBeLessThan(5_000);

    const interrupted = getRunView(db, HHT, created.id)!;
    expect(interrupted.status).toBe('running');
    expect(interrupted.counts.pending).toBeGreaterThan(0);
    const issuedBefore = interrupted.counts.issued;
    await new Promise((r) => setTimeout(r, 50));
    expect(getRunView(db, HHT, created.id)!.processed).toBe(interrupted.processed); // really stopped

    const second = await start({ db });
    await second.ready();
    const done = await completed(db, HHT, created.id);
    expect(done.counts).toEqual({ issued: 8, skipped: 7, failed: 1, pending: 0 });
    expect(issuedBefore).toBeLessThan(8);
    expect(scalar(db, 'SELECT COUNT(*) AS n FROM certificates WHERE course_id = ?', FIRE)).toBe(11);
    expect(scalar(db, "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'ISSUE' AND run_id = ?", created.id)).toBe(8);
    expect(
      scalar(db, 'SELECT COUNT(*) AS n FROM (SELECT learner_id FROM certificates WHERE course_id = ? GROUP BY learner_id HAVING COUNT(*) > 1)', FIRE),
    ).toBe(0);
  });
});

describe('NHI (Brisbane)', () => {
  it('issues NHI-2026 serials at the current instant, matching the classifier', async () => {
    const app = await start();
    const alice = await signIn(app, 'alice');
    const course = SEED_IDS.courses.nhiMentalHealthFirstAid;
    const expected = (
      app.db
        .prepare(
          `SELECT e.learner_id, e.status AS es, l.status AS ls, c.status AS cs
             FROM enrollments e JOIN learners l ON l.id = e.learner_id
             LEFT JOIN certificates c ON c.course_id = e.course_id AND c.learner_id = e.learner_id
            WHERE e.tenant_id = ? AND e.course_id = ?`,
        )
        .all(NHI, course) as Array<{ learner_id: number; es: 'enrolled' | 'completed'; ls: 'active' | 'inactive'; cs: 'valid' | 'revoked' | null }>
    ).map((r) => ({ id: r.learner_id, ...classifyEnrollment({ enrollmentStatus: r.es, learnerStatus: r.ls, certificateStatus: r.cs }) }));
    expect(expected.length).toBeGreaterThan(0);

    const run = await completed(app.db, NHI, (await startRun(app, alice, NHI, course)).id);
    expect(run.total).toBe(expected.length);
    for (const e of expected) {
      expect(run.items.find((i) => i.learnerId === e.id)).toMatchObject({ outcome: e.outcome, reason: e.reason });
    }
    const issued = run.items.filter((i) => i.outcome === 'issued');
    expect(issued.length).toBe(expected.filter((e) => e.outcome === 'issued').length);
    issued.forEach((item, idx) => {
      expect(item.serial).toBe(`NHI-2026-${String(idx + 1).padStart(6, '0')}`);
    });
    const rows = app.db.prepare('SELECT issued_at, issued_by FROM certificates WHERE tenant_id = ?').all(NHI) as Array<{ issued_at: string; issued_by: string }>;
    expect(rows).toHaveLength(issued.length);
    for (const r of rows) expect(r).toEqual({ issued_at: NOW, issued_by: 'alice' });
  });
});

describe('preview and run agree', () => {
  it('after a run, Fire Safety shows eligible 0 / alreadyIssued 11', async () => {
    const app = await start();
    const alice = await signIn(app, 'alice');
    const list = async () => {
      const res = await app.inject({ method: 'GET', url: `/api/tenants/${HHT}/courses`, headers: { cookie: alice } });
      return coursesResponseSchema.parse(res.json()).items.find((c) => c.id === FIRE)!;
    };
    expect((await list()).counts).toEqual({ eligible: 8, alreadyIssued: 3, notCompleted: 4, inactive: 1 });
    await completed(app.db, HHT, (await startRun(app, alice, HHT, FIRE)).id);
    expect((await list()).counts).toEqual({ eligible: 0, alreadyIssued: 11, notCompleted: 4, inactive: 1 });
  });
});
