// Tenant × admin isolation for the bulk-issue routes (SPEC §3.3 T4, §3.4). The access-matrix
// helper cannot express "a course id valid in each allowed tenant", so each pair is spelled out.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bulkIssueRunResponseSchema, errorResponseSchema } from '@cac/shared';
import { ACCESS_MATRIX, MALFORMED_TENANT_IDS, TENANTS } from '../helpers/access-matrix';
import { buildTestApp, signIn } from '../helpers/app';

/** One course per tenant (HHT, SRA, LCL, NHI). */
const COURSE_OF: Record<number, number> = { 1: 101, 2: 201, 3: 301, 4: 401 };

let app: FastifyInstance;
const cookies: Record<string, string> = {};
beforeAll(async () => {
  app = await buildTestApp();
  for (const { admin } of ACCESS_MATRIX) cookies[admin] = await signIn(app, admin);
});
afterAll(() => app.close());

const post = (tid: string | number, cid: string | number, cookie?: string, key = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: `/api/tenants/${tid}/courses/${cid}/bulk-issue`,
    headers: { ...(cookie ? { cookie } : {}), 'idempotency-key': key },
  });
const get = (tid: string | number, runId: string | number, cookie?: string) =>
  app.inject({ method: 'GET', url: `/api/tenants/${tid}/bulk-issue-runs/${runId}`, headers: cookie ? { cookie } : {} });
const expectNotFound = (res: { statusCode: number; json: () => unknown }) => {
  expect(res.statusCode).toBe(404);
  expect(errorResponseSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
};

describe.each(ACCESS_MATRIX)('$admin', ({ admin, allowed, denied }) => {
  for (const tid of allowed) {
    const tenant = TENANTS.find((t) => t.id === tid)!;
    it(`POST + GET run in ${tenant.code} -> 202 + 200`, async () => {
      const created = await post(tid, COURSE_OF[tid], cookies[admin]);
      expect(created.statusCode).toBe(202);
      const { run } = bulkIssueRunResponseSchema.parse(created.json());
      expect(run.createdBy.id).toBe(admin);
      const read = await get(tid, run.id, cookies[admin]);
      expect(read.statusCode).toBe(200);
      expect(bulkIssueRunResponseSchema.parse(read.json()).run.id).toBe(run.id);
    });
    it(`POST in ${tenant.code} with a course of another tenant -> 404`, async () => {
      const foreign = COURSE_OF[TENANTS.find((t) => t.id !== tid)!.id];
      expectNotFound(await post(tid, foreign, cookies[admin]));
    });
    it(`POST in ${tenant.code} with unknown / malformed course ids -> 404`, async () => {
      for (const cid of ['999', '0', 'abc', '01', '-1', '1.5']) expectNotFound(await post(tid, cid, cookies[admin]));
    });
    it(`GET unknown / malformed run ids in ${tenant.code} -> 404`, async () => {
      for (const runId of ['99999', '0', 'abc', '01', '-1', '1.5']) expectNotFound(await get(tid, runId, cookies[admin]));
    });
  }
  for (const tid of denied) {
    const tenant = TENANTS.find((t) => t.id === tid)!;
    it(`POST + GET in ${tenant.code} -> 404`, async () => {
      expectNotFound(await post(tid, COURSE_OF[tid], cookies[admin]));
      expectNotFound(await get(tid, 1, cookies[admin]));
    });
  }
  it('malformed tenant ids -> 404 for POST and GET', async () => {
    for (const tid of MALFORMED_TENANT_IDS) {
      expectNotFound(await post(tid, 101, cookies[admin]));
      expectNotFound(await get(tid, 1, cookies[admin]));
    }
  });
});

describe('a run of one tenant is never readable through another', () => {
  it('404 for every other (admin, tenant) pair that is allowed to see that tenant', async () => {
    const { run } = bulkIssueRunResponseSchema.parse((await post(1, 101, cookies.alice)).json());
    // alice's other tenants and bob's tenant: the run id does not exist there.
    expectNotFound(await get(2, run.id, cookies.alice));
    expectNotFound(await get(4, run.id, cookies.alice));
    expectNotFound(await get(3, run.id, cookies.bob));
    // carol manages HHT too, so she can read it.
    expect((await get(1, run.id, cookies.carol)).statusCode).toBe(200);
  });
});

describe('no session', () => {
  it('POST and GET -> 401 for every tenant id', async () => {
    for (const tid of [...TENANTS.map((t) => t.id), ...MALFORMED_TENANT_IDS]) {
      for (const res of [await post(tid, 101), await get(tid, 1)]) {
        expect(res.statusCode).toBe(401);
        expect(errorResponseSchema.parse(res.json()).error.code).toBe('UNAUTHORIZED');
      }
    }
  });
});
