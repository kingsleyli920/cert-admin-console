import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { bulkIssueRunResponseSchema } from '@cac/shared';
import { SEED_IDS } from '../../src/db/seed';
import { buildTestApp, signIn } from '../helpers/app';

const HHT = SEED_IDS.tenants.hht;
const FIRE_SAFETY = SEED_IDS.courses.fireSafety2026;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = (app: FastifyInstance, sql: string) => (app.db.prepare(sql).get() as { n: number }).n;

describe('POST /api/__test__/reset while a bulk-issue run is in progress', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  it('stops the run first, so nothing is written into the freshly seeded database', async () => {
    app = await buildTestApp({ delayMs: 50 });
    const cookie = await signIn(app, 'alice');
    const res = await app.inject({
      method: 'POST',
      url: `/api/tenants/${HHT}/courses/${FIRE_SAFETY}/bulk-issue`,
      headers: { cookie, 'idempotency-key': randomUUID() },
    });
    expect(res.statusCode).toBe(202);
    await sleep(120); // a few of the 16 items are settled, most are still pending

    expect((await app.inject({ method: 'POST', url: '/api/__test__/reset' })).statusCode).toBe(204);
    await sleep(300); // long enough for several more items if the runner were still alive

    expect(count(app, 'SELECT COUNT(*) AS n FROM bulk_issue_runs')).toBe(0);
    expect(count(app, `SELECT COUNT(*) AS n FROM certificates WHERE tenant_id = ${HHT}`)).toBe(45);
    expect(count(app, `SELECT next_serial AS n FROM tenants WHERE id = ${HHT}`)).toBe(46);
  });

  it('a run created right after the reset is processed for its own course, not by the old loop', async () => {
    // SQLite reuses rowids once the table is empty, so the new run gets the old run's id.
    app = await buildTestApp({ delayMs: 50 });
    const alice = await signIn(app, 'alice');
    const issue = (cookie: string, courseId: number) =>
      app.inject({
        method: 'POST',
        url: `/api/tenants/${HHT}/courses/${courseId}/bulk-issue`,
        headers: { cookie, 'idempotency-key': randomUUID() },
      });
    expect((await issue(alice, FIRE_SAFETY)).statusCode).toBe(202);
    await sleep(120);
    expect((await app.inject({ method: 'POST', url: '/api/__test__/reset' })).statusCode).toBe(204);

    const carol = await signIn(app, 'carol');
    const res = await issue(carol, SEED_IDS.courses.manualHandling);
    const run = bulkIssueRunResponseSchema.parse(res.json()).run;
    for (let i = 0; i < 400; i++) {
      const get = await app.inject({ method: 'GET', url: `/api/tenants/${HHT}/bulk-issue-runs/${run.id}`, headers: { cookie: carol } });
      if (bulkIssueRunResponseSchema.parse(get.json()).run.status === 'completed') break;
      await sleep(10);
    }
    // Nothing for Fire Safety beyond the seed; every new certificate belongs to the new run's course and actor.
    expect(count(app, `SELECT COUNT(*) AS n FROM certificates WHERE course_id = ${FIRE_SAFETY}`)).toBe(3);
    expect(count(app, "SELECT COUNT(*) AS n FROM audit_logs WHERE run_id IS NOT NULL AND actor_id <> 'carol'")).toBe(0);
    const final = bulkIssueRunResponseSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/tenants/${HHT}/bulk-issue-runs/${run.id}`, headers: { cookie: carol } })).json(),
    ).run;
    expect(final).toMatchObject({ status: 'completed', courseId: SEED_IDS.courses.manualHandling, createdBy: { id: 'carol' } });
  });

  it('keeps accepting new runs after a reset', async () => {
    app = await buildTestApp();
    const cookie = await signIn(app, 'alice');
    expect((await app.inject({ method: 'POST', url: '/api/__test__/reset' })).statusCode).toBe(204);

    const res = await app.inject({
      method: 'POST',
      url: `/api/tenants/${HHT}/courses/${FIRE_SAFETY}/bulk-issue`,
      headers: { cookie, 'idempotency-key': randomUUID() },
    });
    const runId = bulkIssueRunResponseSchema.parse(res.json()).run.id;
    for (let i = 0; i < 200; i++) {
      const get = await app.inject({ method: 'GET', url: `/api/tenants/${HHT}/bulk-issue-runs/${runId}`, headers: { cookie } });
      if (bulkIssueRunResponseSchema.parse(get.json()).run.status === 'completed') break;
      await sleep(5);
    }
    expect(count(app, `SELECT COUNT(*) AS n FROM certificates WHERE tenant_id = ${HHT}`)).toBe(53);
  });
});
