import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bulkIssueRunResponseSchema, certificateListResponseSchema, errorResponseSchema, type BulkIssueRun } from '@cac/shared';
import { startRealServer, type RealServer } from '../helpers/real-server';

let server: RealServer;
const cookies: Record<string, string> = {};
beforeAll(async () => {
  server = await startRealServer();
  for (const adminId of ['alice', 'carol']) {
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

const issue = (admin: string, key: string, courseId = 101) =>
  fetch(`${server.url}/api/tenants/1/courses/${courseId}/bulk-issue`, {
    method: 'POST',
    headers: { cookie: cookies[admin], 'idempotency-key': key },
  });
async function runOf(res: Response): Promise<BulkIssueRun> {
  expect(res.status).toBe(202);
  return bulkIssueRunResponseSchema.parse(await res.json()).run;
}
async function waitCompleted(admin: string, runId: number): Promise<BulkIssueRun> {
  for (let i = 0; i < 200; i++) {
    const res = await fetch(`${server.url}/api/tenants/1/bulk-issue-runs/${runId}`, { headers: { cookie: cookies[admin] } });
    expect(res.status).toBe(200);
    const { run } = bulkIssueRunResponseSchema.parse(await res.json());
    if (run.status === 'completed') return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete`);
}
async function certificateTotal(): Promise<number> {
  const res = await fetch(`${server.url}/api/tenants/1/certificates?courseId=101`, { headers: { cookie: cookies.alice } });
  return certificateListResponseSchema.parse(await res.json()).total;
}

describe('bulk issue over a real server process (HHT)', () => {
  it('two concurrent POSTs with the same key return the same run', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([issue('alice', key, 102), issue('alice', key, 102)]);
    const [runA, runB] = [await runOf(a), await runOf(b)];
    expect(runB.id).toBe(runA.id);
    const done = await waitCompleted('alice', runA.id);
    expect(done.counts.pending).toBe(0);
    // A third, later retry still gets that run and issues nothing new.
    expect((await runOf(await issue('alice', key, 102))).id).toBe(runA.id);
  });

  it('a different course under a used key is 422', async () => {
    const key = randomUUID();
    await runOf(await issue('alice', key, 103));
    const res = await issue('alice', key, 104);
    expect(res.status).toBe(422);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('alice and carol with different keys at the same time issue exactly 8 new Fire Safety certificates', async () => {
    expect(await certificateTotal()).toBe(3);
    const [a, b] = await Promise.all([issue('alice', randomUUID()), issue('carol', randomUUID())]);
    const [runA, runB] = [await runOf(a), await runOf(b)];
    expect(runA.id).not.toBe(runB.id);
    const [doneA, doneB] = [await waitCompleted('alice', runA.id), await waitCompleted('carol', runB.id)];
    expect(doneA.counts.issued + doneB.counts.issued).toBe(8);
    expect(await certificateTotal()).toBe(11);
  });
});
