// Acceptance tests for idempotent bulk issue (SPEC §1.3, §3.3 T1–T3, §3.4).
// Written by the main agent before implementation; the implementation must make
// these pass without editing them.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bulkIssueRunResponseSchema, errorResponseSchema, type BulkIssueRun } from '@cac/shared';
import { SEED_IDS } from '../../src/db/seed';
import { buildTestApp, signIn } from '../helpers/app';

const HHT = SEED_IDS.tenants.hht;
const FIRE_SAFETY = SEED_IDS.courses.fireSafety2026;
const FS = SEED_IDS.learners.fireSafety;
const NOW = '2026-10-20T01:00:00.000Z';

function post(app: FastifyInstance, cookie: string, tid: number, cid: number, key?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/tenants/${tid}/courses/${cid}/bulk-issue`,
    headers: { cookie, ...(key === undefined ? {} : { 'idempotency-key': key }) },
  });
}

async function waitForRun(app: FastifyInstance, cookie: string, tid: number, runId: number) {
  for (let i = 0; i < 400; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/tenants/${tid}/bulk-issue-runs/${runId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const { run } = bulkIssueRunResponseSchema.parse(res.json());
    if (run.status === 'completed') return run;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`run ${runId} did not complete`);
}

async function issue(app: FastifyInstance, cookie: string, key = randomUUID(), tid = HHT, cid = FIRE_SAFETY) {
  const res = await post(app, cookie, tid, cid, key);
  expect(res.statusCode).toBe(202);
  const { run } = bulkIssueRunResponseSchema.parse(res.json());
  return { created: run, done: await waitForRun(app, cookie, tid, run.id) };
}

const count = (app: FastifyInstance, sql: string, ...params: (string | number)[]) =>
  (app.db.prepare(sql).get(...params) as { n: number }).n;
const certCount = (app: FastifyInstance) =>
  count(app, 'SELECT COUNT(*) AS n FROM certificates WHERE tenant_id = ? AND course_id = ?', HHT, FIRE_SAFETY);
const issueAuditCount = (app: FastifyInstance) =>
  count(app, "SELECT COUNT(*) AS n FROM audit_logs WHERE tenant_id = ? AND action = 'ISSUE'", HHT);
const outcomeOf = (run: BulkIssueRun, learnerId: number) => run.items.find((i) => i.learnerId === learnerId);

describe('bulk issue — acceptance', () => {
  let app: FastifyInstance;
  let alice: string;
  let carol: string;
  let bob: string;

  beforeEach(async () => {
    app = await buildTestApp({ now: () => new Date(NOW) });
    alice = await signIn(app, 'alice');
    carol = await signIn(app, 'carol');
    bob = await signIn(app, 'bob');
  });
  afterEach(() => app.close());

  it('issues to every eligible learner and reports each learner outcome (§1.3)', async () => {
    const { created, done } = await issue(app, alice);
    expect(created.total).toBe(16);
    expect(done.counts).toEqual({ issued: 8, skipped: 7, failed: 1, pending: 0 });
    expect(done.processed).toBe(16);
    expect(done.createdBy.id).toBe('alice');

    for (const id of FS.completedNoCert) {
      expect(outcomeOf(done, id)).toMatchObject({ outcome: 'issued', reason: null });
      expect(outcomeOf(done, id)?.serial).toMatch(/^HHT-2026-\d{6}$/);
    }
    // Skipped because a certificate exists → the item references that existing certificate.
    for (const id of FS.valid) {
      const item = outcomeOf(done, id);
      expect(item).toMatchObject({ outcome: 'skipped', reason: 'already_issued' });
      expect(SEED_IDS.certificates.fireSafetyValid).toContain(item?.certificateId);
      expect(item?.serial).toMatch(/^HHT-\d{4}-\d{6}$/);
    }
    expect(outcomeOf(done, FS.revoked)).toMatchObject({
      outcome: 'skipped',
      reason: 'revoked',
      certificateId: SEED_IDS.certificates.fireSafetyRevoked,
    });
    // Nothing to reference for not-completed / failed learners.
    for (const id of [...FS.enrolledNotCompleted, FS.completedInactive]) {
      expect(outcomeOf(done, id)).toMatchObject({ certificateId: null, serial: null });
    }
    for (const id of FS.enrolledNotCompleted) expect(outcomeOf(done, id)).toMatchObject({ outcome: 'skipped', reason: 'not_completed' });
    expect(outcomeOf(done, FS.completedInactive)).toMatchObject({ outcome: 'failed', reason: 'learner_inactive' });
  });

  it('assigns contiguous per-tenant serials continuing from the seed (HHT has 45)', async () => {
    const { done } = await issue(app, alice);
    const serials = done.items.filter((i) => i.outcome === 'issued').map((i) => i.serial).sort();
    expect(serials).toEqual([46, 47, 48, 49, 50, 51, 52, 53].map((n) => `HHT-2026-0000${n}`));
  });

  it('writes one ISSUE audit row per issued certificate with actor, run and timestamp', async () => {
    const before = issueAuditCount(app);
    const { done } = await issue(app, carol);
    expect(issueAuditCount(app) - before).toBe(8);
    const rows = app.db
      .prepare("SELECT actor_id, run_id, course_id, learner_id, created_at FROM audit_logs WHERE run_id = ? AND action = 'ISSUE' ORDER BY learner_id")
      .all(done.id) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.learner_id)).toEqual([...FS.completedNoCert]);
    for (const r of rows) expect(r).toMatchObject({ actor_id: 'carol', course_id: FIRE_SAFETY, created_at: NOW });
  });

  it('T1: the same Idempotency-Key replays the same run and issues nothing new', async () => {
    const key = randomUUID();
    const first = await issue(app, alice, key);
    const certs = certCount(app);
    const audits = issueAuditCount(app);

    const again = await post(app, alice, HHT, FIRE_SAFETY, key);
    expect(again.statusCode).toBe(202);
    expect(bulkIssueRunResponseSchema.parse(again.json()).run.id).toBe(first.created.id);
    expect(certCount(app)).toBe(certs);
    expect(issueAuditCount(app)).toBe(audits);
    expect(count(app, 'SELECT COUNT(*) AS n FROM bulk_issue_runs')).toBe(1);
  });

  it('T1: a retry that arrives while the run is still running gets the same run', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([post(app, alice, HHT, FIRE_SAFETY, key), post(app, alice, HHT, FIRE_SAFETY, key)]);
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    const runA = bulkIssueRunResponseSchema.parse(a.json()).run.id;
    expect(bulkIssueRunResponseSchema.parse(b.json()).run.id).toBe(runA);
    await waitForRun(app, alice, HHT, runA);
    expect(certCount(app)).toBe(3 + 8);
  });

  it('T2: a new key after completion skips everyone and issues nothing', async () => {
    await issue(app, alice);
    const certs = certCount(app);
    const { done } = await issue(app, alice);
    expect(done.counts).toEqual({ issued: 0, skipped: 15, failed: 1, pending: 0 });
    for (const id of FS.completedNoCert) expect(outcomeOf(done, id)).toMatchObject({ outcome: 'skipped', reason: 'already_issued' });
    expect(certCount(app)).toBe(certs);
  });

  it('T3: two admins with different keys concurrently → at most one certificate per learner', async () => {
    const before = issueAuditCount(app);
    const [r1, r2] = await Promise.all([issue(app, alice), issue(app, carol)]);
    expect(r1.done.id).not.toBe(r2.done.id);
    expect(r1.done.counts.issued + r2.done.counts.issued).toBe(8);
    expect(certCount(app)).toBe(3 + 8);
    expect(issueAuditCount(app) - before).toBe(8);
    const dupes = count(
      app,
      'SELECT COUNT(*) AS n FROM (SELECT learner_id FROM certificates WHERE course_id = ? GROUP BY learner_id HAVING COUNT(*) > 1)',
      FIRE_SAFETY,
    );
    expect(dupes).toBe(0);
    const serials = app.db
      .prepare("SELECT serial FROM certificates WHERE tenant_id = ? AND serial > 'HHT-2026-000045' ORDER BY serial")
      .all(HHT)
      .map((r) => (r as { serial: string }).serial);
    expect(serials).toEqual([46, 47, 48, 49, 50, 51, 52, 53].map((n) => `HHT-2026-0000${n}`));
  });

  it('rejects the same key for a different course with 422 and creates no run', async () => {
    const key = randomUUID();
    await issue(app, alice, key);
    const res = await post(app, alice, HHT, SEED_IDS.courses.manualHandling, key);
    expect(res.statusCode).toBe(422);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(count(app, 'SELECT COUNT(*) AS n FROM bulk_issue_runs')).toBe(1);
  });

  it.each([
    ['missing', undefined],
    ['not a UUID', 'retry-1'],
  ])('rejects a %s Idempotency-Key with 400', async (_label, key) => {
    const res = await post(app, alice, HHT, FIRE_SAFETY, key);
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(count(app, 'SELECT COUNT(*) AS n FROM bulk_issue_runs')).toBe(0);
  });

  it('keeps runs and courses tenant-scoped (§3.4)', async () => {
    // A course of another tenant addressed through an allowed tenant id.
    expect((await post(app, alice, HHT, SEED_IDS.courses.sraFoodSafetyBasics, randomUUID())).statusCode).toBe(404);
    // A tenant the admin does not manage.
    expect((await post(app, alice, SEED_IDS.tenants.lcl, SEED_IDS.courses.lclFirst, randomUUID())).statusCode).toBe(404);
    expect((await post(app, bob, HHT, FIRE_SAFETY, randomUUID())).statusCode).toBe(404);
    // A run of another tenant cannot be read through any tenant id.
    const bobRun = (await issue(app, bob, randomUUID(), SEED_IDS.tenants.lcl, SEED_IDS.courses.lclFirst)).done;
    for (const url of [`/api/tenants/${HHT}/bulk-issue-runs/${bobRun.id}`, `/api/tenants/${SEED_IDS.tenants.lcl}/bulk-issue-runs/${bobRun.id}`]) {
      expect((await app.inject({ method: 'GET', url, headers: { cookie: alice } })).statusCode).toBe(404);
    }
    // carol (HHT) can read a run alice created in HHT.
    const aliceRun = (await issue(app, alice)).done;
    expect((await app.inject({ method: 'GET', url: `/api/tenants/${HHT}/bulk-issue-runs/${aliceRun.id}`, headers: { cookie: carol } })).statusCode).toBe(200);
    // No session.
    expect((await post(app, '', HHT, FIRE_SAFETY, randomUUID())).statusCode).toBe(401);
  });

  it('completes immediately with total 0 for a course without enrollments', async () => {
    app.db.prepare("INSERT INTO courses (id, tenant_id, title) VALUES (199, ?, 'Empty course')").run(HHT);
    const { created, done } = await issue(app, alice, randomUUID(), HHT, 199);
    expect(created.total).toBe(0);
    expect(done).toMatchObject({ total: 0, processed: 0, items: [] });
  });

  it('uses the tenant-local year in serials at the New Year boundary', async () => {
    // 2025-12-31T14:30Z is 01:30 on 1 Jan 2026 in Sydney but 22:30 on 31 Dec 2025 in Perth.
    await app.close();
    app = await buildTestApp({ now: () => new Date('2025-12-31T14:30:00.000Z') });
    alice = await signIn(app, 'alice');
    const sra = SEED_IDS.tenants.sra;
    app.db.prepare("INSERT INTO learners (id, tenant_id, name, email, status) VALUES (2999, ?, 'New Year Learner', 'ny@sra.example', 'active')").run(sra);
    app.db
      .prepare("INSERT INTO enrollments (tenant_id, course_id, learner_id, status, completed_at) VALUES (?, ?, 2999, 'completed', '2025-12-30T00:00:00.000Z')")
      .run(sra, SEED_IDS.courses.sraFoodSafetyBasics);

    const hht = await issue(app, alice);
    for (const item of hht.done.items.filter((i) => i.outcome === 'issued')) expect(item.serial).toMatch(/^HHT-2026-/);
    const perth = await issue(app, alice, randomUUID(), sra, SEED_IDS.courses.sraFoodSafetyBasics);
    expect(outcomeOf(perth.done, 2999)?.serial).toMatch(/^SRA-2025-\d{6}$/);
  });
});
