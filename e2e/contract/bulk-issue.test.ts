import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bulkIssueRunResponseSchema, errorResponseSchema, tenantLocalYear, type BulkIssueRun } from '@cac/shared';
import { ACCESS_MATRIX, tenantById } from '../../server/test/helpers/access-matrix';
import { startRealServer, type RealServer } from '../../server/test/helpers/real-server';
import { ApiError, createApiClient, type ApiClient } from '../../web/src/api/client';

// Real server process (temp DB) + the web app's real api client. Raw fetch is used where the
// client cannot express the request (missing / invalid key) or hides what is asserted (status).
let server: RealServer;
const cookies: Record<string, string> = {};

async function signIn(adminId: string): Promise<string> {
  const res = await fetch(`${server.url}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adminId }),
  });
  expect(res.status).toBe(204);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

async function startFresh(): Promise<void> {
  server = await startRealServer();
  for (const { admin } of ACCESS_MATRIX) cookies[admin] = await signIn(admin);
}

const clientFor = (admin?: string): ApiClient =>
  createApiClient({ baseUrl: server.url, headers: admin ? { cookie: cookies[admin] } : undefined });

async function apiError(fn: () => Promise<unknown>): Promise<ApiError> {
  const err = await fn().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

function rawPost(path: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${server.url}${path}`, { method: 'POST', headers });
}

/** Polls GET until the run completes, parsing every poll with the client. */
async function waitCompleted(client: ApiClient, tid: number, runId: number): Promise<BulkIssueRun> {
  for (let i = 0; i < 400; i++) {
    const run = await client.getRun(tid, runId);
    expect(run.id).toBe(runId);
    if (run.status === 'completed') return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} did not complete`);
}

async function expectRawError(res: Response, status: number, code: string, err?: ApiError): Promise<void> {
  expect(res.status).toBe(status);
  const { error } = errorResponseSchema.parse(await res.json());
  expect(error.code).toBe(code);
  if (err) expect(error).toEqual({ code: err.code, message: err.message });
}

describe('bulk issue and runs (HHT, alice)', () => {
  beforeAll(startFresh);
  afterAll(() => server.stop());

  it('bulkIssue parses the 202 run; getRun parses until Fire Safety reaches issued 8 / skipped 7 / failed 1', async () => {
    const alice = clientFor('alice');
    const created = await alice.bulkIssue(1, 101, randomUUID());
    expect(created).toMatchObject({ courseId: 101, courseTitle: 'Fire Safety 2026', total: 16, createdBy: { id: 'alice' } });

    const done = await waitCompleted(alice, 1, created.id);
    expect(done.counts).toEqual({ issued: 8, skipped: 7, failed: 1, pending: 0 });
    expect(done.processed).toBe(16);
    expect(done.items).toHaveLength(16);
  });

  it('the first POST is a 202 and a replay with the same key returns the same run id', async () => {
    const alice = clientFor('alice');
    const key = randomUUID();
    const path = '/api/tenants/1/courses/102/bulk-issue';
    const first = await rawPost(path, { cookie: cookies.alice, 'idempotency-key': key });
    expect(first.status).toBe(202);
    const firstRun = bulkIssueRunResponseSchema.parse(await first.json()).run;

    const replayedByClient = await alice.bulkIssue(1, 102, key);
    const replayedRaw = await rawPost(path, { cookie: cookies.alice, 'idempotency-key': key });
    expect(replayedRaw.status).toBe(202);
    expect(replayedByClient.id).toBe(firstRun.id);
    expect(bulkIssueRunResponseSchema.parse(await replayedRaw.json()).run.id).toBe(firstRun.id);
    await waitCompleted(alice, 1, firstRun.id);
  });

  it.each([
    ['missing', undefined],
    ['not a UUID', 'retry-1'],
  ])('a %s Idempotency-Key is 400 VALIDATION_ERROR', async (_label, key) => {
    const res = await rawPost('/api/tenants/1/courses/101/bulk-issue', {
      cookie: cookies.alice,
      ...(key === undefined ? {} : { 'idempotency-key': key }),
    });
    await expectRawError(res, 400, 'VALIDATION_ERROR');
  });

  it('the client refuses to send a key that is not a UUID', async () => {
    await expect(clientFor('alice').bulkIssue(1, 101, 'retry-1')).rejects.toThrow();
  });

  it('the same key for another course is ApiError 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const alice = clientFor('alice');
    const key = randomUUID();
    await alice.bulkIssue(1, 103, key);

    const err = await apiError(() => alice.bulkIssue(1, 104, key));
    expect(err.status).toBe(422);
    expect(err.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const raw = await rawPost('/api/tenants/1/courses/104/bulk-issue', { cookie: cookies.alice, 'idempotency-key': key });
    await expectRawError(raw, 422, 'IDEMPOTENCY_KEY_REUSED', err);
  });

  it('a tenant the admin does not manage is 404 NOT_FOUND for bulkIssue and getRun', async () => {
    const bobRun = await clientFor('bob').bulkIssue(3, 301, randomUUID());

    for (const [who, tid, runId] of [
      ['alice', 3, bobRun.id],
      ['bob', 1, 1],
    ] as const) {
      const issueErr = await apiError(() => clientFor(who).bulkIssue(tid, tid === 3 ? 301 : 101, randomUUID()));
      expect([who, tid, issueErr.status, issueErr.code]).toEqual([who, tid, 404, 'NOT_FOUND']);
      const runErr = await apiError(() => clientFor(who).getRun(tid, runId));
      expect([who, tid, runErr.status, runErr.code]).toEqual([who, tid, 404, 'NOT_FOUND']);
    }
    const raw = await rawPost('/api/tenants/3/courses/301/bulk-issue', { cookie: cookies.alice, 'idempotency-key': randomUUID() });
    await expectRawError(raw, 404, 'NOT_FOUND');
  });

  it("another tenant's course through an allowed tenant id is 404, and so is another tenant's run", async () => {
    const alice = clientFor('alice');
    const courseErr = await apiError(() => alice.bulkIssue(1, 201, randomUUID())); // 201 belongs to SRA
    expect([courseErr.status, courseErr.code]).toEqual([404, 'NOT_FOUND']);

    const sraRun = await alice.bulkIssue(2, 201, randomUUID());
    const runErr = await apiError(() => alice.getRun(1, sraRun.id)); // run lives in SRA, asked through HHT
    expect([runErr.status, runErr.code]).toEqual([404, 'NOT_FOUND']);
    await waitCompleted(alice, 2, sraRun.id);
  });

  it('an unknown run is 404 NOT_FOUND with a schema-valid body', async () => {
    const err = await apiError(() => clientFor('alice').getRun(1, 999_999));
    expect([err.status, err.code]).toEqual([404, 'NOT_FOUND']);
    const raw = await fetch(`${server.url}/api/tenants/1/bulk-issue-runs/999999`, { headers: { cookie: cookies.alice } });
    await expectRawError(raw, 404, 'NOT_FOUND', err);
  });

  it('without a cookie every bulk-issue route is 401 UNAUTHORIZED', async () => {
    const anon = clientFor();
    const issueErr = await apiError(() => anon.bulkIssue(1, 101, randomUUID()));
    const runErr = await apiError(() => anon.getRun(1, 1));
    const coursesErr = await apiError(() => anon.listCourses(1));
    for (const err of [issueErr, runErr, coursesErr]) expect([err.status, err.code]).toEqual([401, 'UNAUTHORIZED']);
    const raw = await rawPost('/api/tenants/1/courses/101/bulk-issue', { 'idempotency-key': randomUUID() });
    await expectRawError(raw, 401, 'UNAUTHORIZED', issueErr);
  });
});

describe('tenant x admin x timezone matrix (real server, fresh DB)', () => {
  beforeAll(startFresh);
  afterAll(() => server.stop());

  // One course per admin and tenant; carol uses HHT 102 so no case depends on alice having issued 101.
  const COURSE: Record<string, Record<number, number>> = {
    alice: { 1: 101, 2: 201, 4: 401 },
    carol: { 1: 102 },
    bob: { 3: 301 },
  };

  const cases = ACCESS_MATRIX.flatMap(({ admin, allowed }) => allowed.map((tid) => ({ admin, tid, courseId: COURSE[admin][tid] })));

  it.each(cases)('$admin: tenant $tid lists courses and bulk issues course $courseId', async ({ admin, tid, courseId }) => {
    const client = clientFor(admin);
    const tenant = tenantById(tid);

    const { items } = await client.listCourses(tid);
    const course = items.find((c) => c.id === courseId);
    expect(course, `course ${courseId} listed for tenant ${tid}`).toBeDefined();

    const created = await client.bulkIssue(tid, courseId, randomUUID());
    const done = await waitCompleted(client, tid, created.id);
    expect(done.createdBy.id).toBe(admin);
    expect(done.counts.pending).toBe(0);
    expect(done.counts.issued).toBe(course!.counts.eligible);

    const serials = done.items.flatMap((i) => (i.serial === null ? [] : [{ serial: i.serial, outcome: i.outcome }]));
    for (const { serial } of serials) expect(serial).toMatch(new RegExp(`^${tenant.code}-\\d{4}-\\d{6}$`));
    const year = tenantLocalYear(new Date().toISOString(), tenant.timezone);
    for (const { serial } of serials.filter((s) => s.outcome === 'issued')) {
      expect(serial.startsWith(`${tenant.code}-${year}-`)).toBe(true);
    }

    const after = (await client.listCourses(tid)).items.find((c) => c.id === courseId);
    expect(after?.counts.eligible).toBe(0);
  });
});
