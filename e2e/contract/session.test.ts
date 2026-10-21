import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminsResponseSchema, errorResponseSchema, meResponseSchema } from '@cac/shared';
import { ACCESS_MATRIX, tenantById } from '../../server/test/helpers/access-matrix';
import { startRealServer, type RealServer } from '../../server/test/helpers/real-server';
import { ApiError, createApiClient } from '../../web/src/api/client';

let server: RealServer;
beforeAll(async () => {
  server = await startRealServer();
});
afterAll(() => server.stop());

/** Raw sign-in: the web client hides Set-Cookie, so the cookie attributes are asserted here. */
async function rawSignIn(adminId: string): Promise<{ cookie: string; setCookie: string }> {
  const res = await fetch(`${server.url}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adminId }),
  });
  expect(res.status).toBe(204);
  const setCookie = res.headers.get('set-cookie') ?? '';
  return { cookie: setCookie.split(';')[0], setCookie };
}

const clientWith = (cookie?: string) =>
  createApiClient({ baseUrl: server.url, headers: cookie ? { cookie } : undefined });

/** Runs `fn`, expecting an ApiError. */
async function apiError(fn: () => Promise<unknown>): Promise<ApiError> {
  const err = await fn().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe('GET /api/admins', () => {
  it('parses and lists alice, bob and carol', async () => {
    const admins = await clientWith().getAdmins();
    expect(admins.items).toEqual([
      { id: 'alice', name: 'Alice Nguyen' },
      { id: 'bob', name: 'Bob Fraser' },
      { id: 'carol', name: 'Carol Smith' },
    ]);
    const raw = await (await fetch(`${server.url}/api/admins`)).json();
    expect(adminsResponseSchema.parse(raw)).toEqual(admins);
  });
});

describe('POST /api/session then GET /api/me', () => {
  it.each(ACCESS_MATRIX)('$admin: sets an HttpOnly, SameSite=Lax cookie and /me lists the matrix tenants', async (row) => {
    const { cookie, setCookie } = await rawSignIn(row.admin);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const me = await clientWith(cookie).getMe();
    expect(me).toEqual({
      admin: { id: row.admin, name: row.name },
      tenants: row.allowed.map(tenantById),
    });

    const raw = await (await fetch(`${server.url}/api/me`, { headers: { cookie } })).json();
    expect(meResponseSchema.parse(raw)).toEqual(me);
  });

  it('signIn through the web client resolves for a known admin', async () => {
    await expect(clientWith().signIn('alice')).resolves.toBeUndefined();
  });
});

describe('DELETE /api/session', () => {
  it('signOut succeeds with and without a cookie', async () => {
    const { cookie } = await rawSignIn('alice');
    await expect(clientWith(cookie).signOut()).resolves.toBeUndefined();
    await expect(clientWith().signOut()).resolves.toBeUndefined();
  });
});

describe('error responses', () => {
  it('getMe without a cookie is ApiError 401 UNAUTHORIZED with a schema-valid body', async () => {
    const err = await apiError(() => clientWith().getMe());
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');

    const res = await fetch(`${server.url}/api/me`);
    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(await res.json()).error).toEqual({
      code: err.code,
      message: err.message,
    });
  });

  it("signIn('nobody') is ApiError 404 NOT_FOUND with a schema-valid body", async () => {
    const err = await apiError(() => clientWith().signIn('nobody'));
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');

    const res = await fetch(`${server.url}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminId: 'nobody' }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe('NOT_FOUND');
  });

  it.each([{}, { adminId: '' }, { adminId: 42 }])(
    'a malformed sign-in body %j is 400 VALIDATION_ERROR with a schema-valid body',
    async (payload) => {
      const res = await fetch(`${server.url}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(400);
      expect(errorResponseSchema.parse(await res.json()).error.code).toBe('VALIDATION_ERROR');
    },
  );
});
