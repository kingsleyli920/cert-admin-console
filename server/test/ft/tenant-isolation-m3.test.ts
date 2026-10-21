import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorResponseSchema } from '@cac/shared';
import { SEED_IDS } from '../../src/db/seed';
import { buildTestApp, signIn } from '../helpers/app';

const { hht: HHT, sra: SRA, lcl: LCL, nhi: NHI } = SEED_IDS.tenants;

// carol (second HHT admin) is not in the seed yet; add her rows when she lands.
let app: FastifyInstance;
let alice: string;
let bob: string;
beforeAll(async () => {
  app = await buildTestApp();
  alice = await signIn(app, 'alice');
  bob = await signIn(app, 'bob');
});
afterAll(() => app.close());

describe('tenant isolation on the new routes', () => {
  const routes = ['certificates', 'courses'];

  it.each(routes)('%s: alice asking for LCL gets 404', async (route) => {
    const res = await app.inject({ method: 'GET', url: `/api/tenants/${LCL}/${route}`, headers: { cookie: alice } });
    expect(res.statusCode).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
  });

  it.each(routes.flatMap((r) => [HHT, SRA, NHI].map((t) => [r, t] as const)))(
    '%s: bob asking for tenant %i gets 404',
    async (route, tid) => {
      const res = await app.inject({ method: 'GET', url: `/api/tenants/${tid}/${route}`, headers: { cookie: bob } });
      expect(res.statusCode).toBe(404);
    },
  );

  it.each(routes)('%s: no cookie gets 401', async (route) => {
    for (const tid of ['1', '3', '999']) {
      const res = await app.inject({ method: 'GET', url: `/api/tenants/${tid}/${route}` });
      expect(res.statusCode).toBe(401);
      expect(errorResponseSchema.parse(res.json()).error.code).toBe('UNAUTHORIZED');
    }
  });

  it.each(routes.flatMap((r) => ['abc', '0', '-1', '1abc', '999'].map((t) => [r, t] as const)))(
    '%s: malformed or unknown tenant id %s gets 404',
    async (route, tid) => {
      const res = await app.inject({ method: 'GET', url: `/api/tenants/${tid}/${route}`, headers: { cookie: alice } });
      expect(res.statusCode).toBe(404);
    },
  );

  it('an invalid query on a forbidden tenant is still 404, not 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tenants/${LCL}/certificates?pageSize=999`,
      headers: { cookie: alice },
    });
    expect(res.statusCode).toBe(404);
  });
});
