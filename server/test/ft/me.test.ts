import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { meResponseSchema } from '@cac/shared';
import { ACCESS_MATRIX, tenantById } from '../helpers/access-matrix';
import { buildTestApp, signIn } from '../helpers/app';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

async function me(cookie: string) {
  const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return meResponseSchema.parse(res.json());
}

describe('GET /api/me per admin', () => {
  it.each(ACCESS_MATRIX)('$admin gets exactly their tenants, ordered by id, with IANA timezones', async (row) => {
    const result = await me(await signIn(app, row.admin));
    expect(result).toEqual({
      admin: { id: row.admin, name: row.name },
      tenants: row.allowed.map(tenantById),
    });
  });

  it('reports the timezone of each seeded tenant', async () => {
    const alice = await me(await signIn(app, 'alice'));
    const bob = await me(await signIn(app, 'bob'));
    const byCode = Object.fromEntries([...alice.tenants, ...bob.tenants].map((t) => [t.code, t.timezone]));
    expect(byCode).toEqual({
      HHT: 'Australia/Sydney',
      SRA: 'Australia/Perth',
      LCL: 'Australia/Sydney',
      NHI: 'Australia/Brisbane',
    });
  });
});

describe('several sessions', () => {
  it('lets alice and carol be signed in at the same time, each seeing their own /me', async () => {
    const aliceCookie = await signIn(app, 'alice');
    const carolCookie = await signIn(app, 'carol');
    expect(aliceCookie).not.toBe(carolCookie);

    // Interleave the calls: neither sign-in may disturb the other session.
    expect((await me(aliceCookie)).admin.id).toBe('alice');
    expect((await me(carolCookie)).admin.id).toBe('carol');
    expect((await me(aliceCookie)).tenants.map((t) => t.code)).toEqual(['HHT', 'SRA', 'NHI']);
    expect((await me(carolCookie)).tenants.map((t) => t.code)).toEqual(['HHT']);
  });

  it('replaces the cookie when bob signs in after alice on the same client', async () => {
    const aliceCookie = await signIn(app, 'alice');

    // Same client: the browser sends alice's cookie along with the new sign-in.
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { cookie: aliceCookie },
      payload: { adminId: 'bob' },
    });
    expect(res.statusCode).toBe(204);
    const cookies = res.cookies.filter((c) => c.name === 'cac_admin');
    // One Set-Cookie for the same name and path overwrites the old cookie in a browser jar.
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ value: 'bob', path: '/' });

    const result = await me(`cac_admin=${cookies[0].value}`);
    expect(result.admin.id).toBe('bob');
    expect(result.tenants.map((t) => t.code)).toEqual(['LCL']);
  });
});
