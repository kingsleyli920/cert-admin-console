import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { errorResponseSchema, meResponseSchema } from '@cac/shared';
import { requireTenant } from '../../src/plugins/session';
import { describeAccessMatrix } from '../helpers/access-matrix';
import { buildTestApp, signIn } from '../helpers/app';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
  // A stand-in for any future tenant-scoped route.
  app.get('/api/tenants/:tid/ping', async (request) => ({
    admin: request.admin?.id,
    tenant: requireTenant(request),
  }));
});
afterEach(() => app.close());

const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;

describe('GET /api/me', () => {
  it('rejects a request without a cookie with 401 UNAUTHORIZED', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(errorCode(res.json())).toBe('UNAUTHORIZED');
  });

  it.each(['cac_admin=mallory', 'cac_admin=', 'cac_admin=alice%27%20OR%20%271%27%3D%271', 'other=alice'])(
    'rejects a forged or unknown cookie (%s) with 401',
    async (cookie) => {
      const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      expect(res.statusCode).toBe(401);
      expect(errorCode(res.json())).toBe('UNAUTHORIZED');
    },
  );

  it('ignores identity passed in a header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-admin-id': 'alice' } });
    expect(res.statusCode).toBe(401);
  });

  it('returns alice with HHT, SRA and NHI (with timezones) and not LCL', async () => {
    const cookie = await signIn(app, 'alice');
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(meResponseSchema.parse(res.json())).toEqual({
      admin: { id: 'alice', name: 'Alice Nguyen' },
      tenants: [
        { id: 1, code: 'HHT', name: 'Harbour Health Training', timezone: 'Australia/Sydney' },
        { id: 2, code: 'SRA', name: 'Swan River Academy', timezone: 'Australia/Perth' },
        { id: 4, code: 'NHI', name: 'New Horizons Institute', timezone: 'Australia/Brisbane' },
      ],
    });
  });

  it('returns bob with only LCL', async () => {
    const cookie = await signIn(app, 'bob');
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(meResponseSchema.parse(res.json())).toEqual({
      admin: { id: 'bob', name: 'Bob Fraser' },
      tenants: [{ id: 3, code: 'LCL', name: 'Large Corp Learning', timezone: 'Australia/Sydney' }],
    });
  });

  it('stops working after sign-out clears the cookie', async () => {
    const cookie = await signIn(app, 'alice');
    const out = await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie } });
    const cleared = out.cookies.find((c) => c.name === 'cac_admin');
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: `cac_admin=${cleared?.value ?? ''}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

// Every (admin, tenant) pair, malformed ids and the no-session case; see helpers/access-matrix.ts.
describeAccessMatrix('GET /api/tenants/:tid/ping', () => app, {
  expectAllowed: (res, { admin, tenant }) => {
    // The guard resolved the right tenant (code + timezone), not just any allowed one.
    expect(res.json()).toEqual({ admin, tenant });
  },
});

describe('public routes', () => {
  it('keeps health and admins open and sign-in/out reachable without a cookie', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'HEAD', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admins' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/session' })).statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'POST', url: '/api/session', payload: { adminId: 'bob' } })).statusCode,
    ).toBe(204);
  });

  it('still answers unknown routes with 404 rather than 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
  });
});
