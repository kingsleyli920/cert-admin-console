// Bulk issue × certificates list × courses preview, and the tenant-local serial year (SPEC §1.2, §3.4).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bulkIssueRunResponseSchema,
  certificateListResponseSchema,
  coursesResponseSchema,
  type BulkIssueRun,
  type CertificateListItem,
  type CourseSummary,
} from '@cac/shared';
import { SEED_IDS } from '../../src/db/seed';
import { buildTestApp, signIn } from '../helpers/app';

const HHT = SEED_IDS.tenants.hht;
const SRA = SEED_IDS.tenants.sra;
const FIRE_SAFETY = SEED_IDS.courses.fireSafety2026;
const FS = SEED_IDS.learners.fireSafety;
const NOW = '2026-10-20T01:00:00.000Z';

let app: FastifyInstance;
let alice: string;

async function startApp(now: string): Promise<void> {
  app = await buildTestApp({ now: () => new Date(now) });
  alice = await signIn(app, 'alice');
}

async function issue(tid: number, courseId: number): Promise<BulkIssueRun> {
  const post = await app.inject({
    method: 'POST',
    url: `/api/tenants/${tid}/courses/${courseId}/bulk-issue`,
    headers: { cookie: alice, 'idempotency-key': randomUUID() },
  });
  expect(post.statusCode, post.body).toBe(202);
  const { id } = bulkIssueRunResponseSchema.parse(post.json()).run;
  for (let i = 0; i < 400; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/tenants/${tid}/bulk-issue-runs/${id}`, headers: { cookie: alice } });
    const { run } = bulkIssueRunResponseSchema.parse(res.json());
    if (run.status === 'completed') return run;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`run ${id} did not complete`);
}

async function certificates(tid: number, query: string): Promise<{ items: CertificateListItem[]; total: number }> {
  const res = await app.inject({ method: 'GET', url: `/api/tenants/${tid}/certificates?${query}`, headers: { cookie: alice } });
  expect(res.statusCode, res.body).toBe(200);
  return certificateListResponseSchema.parse(res.json());
}

async function course(tid: number, courseId: number): Promise<CourseSummary> {
  const res = await app.inject({ method: 'GET', url: `/api/tenants/${tid}/courses`, headers: { cookie: alice } });
  const found = coursesResponseSchema.parse(res.json()).items.find((c) => c.id === courseId);
  if (!found) throw new Error(`course ${courseId} not listed for tenant ${tid}`);
  return found;
}

afterEach(() => app.close());

describe('bulk issue and the certificates list', () => {
  beforeEach(() => startApp(NOW));

  it('the 8 new Fire Safety certificates appear in the list as valid, issued at the injected now', async () => {
    const before = await certificates(HHT, `courseId=${FIRE_SAFETY}&pageSize=100`);
    expect(before.total).toBe(3);

    const run = await issue(HHT, FIRE_SAFETY);

    const after = await certificates(HHT, `courseId=${FIRE_SAFETY}&pageSize=100`);
    expect(after.total).toBe(11);
    const fresh = after.items.filter((c) => c.issuedAt === NOW);
    expect(fresh).toHaveLength(8);
    expect(fresh.map((c) => c.learnerId).sort()).toEqual([...FS.completedNoCert]);
    for (const c of fresh) expect(c).toMatchObject({ status: 'valid', courseId: FIRE_SAFETY, courseTitle: 'Fire Safety 2026' });

    // The list and the run agree on which certificate belongs to which learner.
    const issued = run.items.filter((i) => i.outcome === 'issued');
    expect(fresh.map((c) => [c.id, c.serial, c.learnerId]).sort()).toEqual(
      issued.map((i) => [i.certificateId, i.serial, i.learnerId]).sort(),
    );
    // The three pre-existing certificates were not touched.
    expect(after.items.filter((c) => c.issuedAt !== NOW).map((c) => c.id).sort()).toEqual(
      before.items.map((c) => c.id).sort(),
    );
  });

  it('the tenant total grows by exactly the issued count (45 -> 53)', async () => {
    expect((await certificates(HHT, '')).total).toBe(45);
    await issue(HHT, FIRE_SAFETY);
    expect((await certificates(HHT, '')).total).toBe(53);
  });
});

describe('bulk issue and the courses preview', () => {
  beforeEach(() => startApp(NOW));

  it('preview eligible equals the run issued count, then both are 0 for the next run', async () => {
    const preview = await course(HHT, FIRE_SAFETY);
    expect(preview.counts).toEqual({ eligible: 8, alreadyIssued: 3, notCompleted: 4, inactive: 1 });

    const first = await issue(HHT, FIRE_SAFETY);
    expect(first.counts.issued).toBe(preview.counts.eligible);
    expect(first.counts.skipped).toBe(preview.counts.alreadyIssued + preview.counts.notCompleted);
    expect(first.counts.failed).toBe(preview.counts.inactive);

    const afterwards = await course(HHT, FIRE_SAFETY);
    expect(afterwards.counts).toEqual({ eligible: 0, alreadyIssued: 11, notCompleted: 4, inactive: 1 });
    const second = await issue(HHT, FIRE_SAFETY);
    expect(second.counts).toEqual({ issued: afterwards.counts.eligible, skipped: 15, failed: 1, pending: 0 });
  });
});

describe('serial year uses the tenant-local year', () => {
  // 2025-12-31T14:30Z is 01:30 on 1 Jan 2026 in Sydney (AEDT) but 22:30 on 31 Dec 2025 in Perth (AWST).
  beforeEach(() => startApp('2025-12-31T14:30:00.000Z'));

  it('SRA (Perth) issues 2025 serials while HHT (Sydney) issues 2026 serials for the same instant', async () => {
    app.db.prepare("INSERT INTO learners (id, tenant_id, name, email, status) VALUES (2999, ?, 'New Year Learner', 'ny@sra.example', 'active')").run(SRA);
    app.db
      .prepare("INSERT INTO enrollments (tenant_id, course_id, learner_id, status, completed_at) VALUES (?, ?, 2999, 'completed', '2025-12-30T00:00:00.000Z')")
      .run(SRA, SEED_IDS.courses.sraFoodSafetyBasics);

    const perth = await issue(SRA, SEED_IDS.courses.sraFoodSafetyBasics);
    const sydney = await issue(HHT, FIRE_SAFETY);

    const perthSerials = perth.items.filter((i) => i.outcome === 'issued').map((i) => i.serial);
    const sydneySerials = sydney.items.filter((i) => i.outcome === 'issued').map((i) => i.serial);
    expect(perthSerials).toHaveLength(1);
    expect(perthSerials[0]).toMatch(/^SRA-2025-\d{6}$/);
    expect(sydneySerials).toHaveLength(8);
    for (const serial of sydneySerials) expect(serial).toMatch(/^HHT-2026-\d{6}$/);

    // Same instant in the list for both tenants: the stored value is UTC, only the serial year differs.
    const sraList = await certificates(SRA, 'q=SRA-2025-&pageSize=100');
    expect(sraList.items.find((c) => c.serial === perthSerials[0])?.issuedAt).toBe('2025-12-31T14:30:00.000Z');
    const hhtList = await certificates(HHT, 'q=HHT-2026-&pageSize=100');
    expect(hhtList.items.filter((c) => c.issuedAt === '2025-12-31T14:30:00.000Z')).toHaveLength(8);
  });
});
