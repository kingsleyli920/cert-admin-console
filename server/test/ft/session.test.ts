import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminsResponseSchema, errorResponseSchema } from '@cac/shared';
import { buildTestApp } from '../helpers/app';

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(() => app.close());

describe('GET /api/admins', () => {
  it('lists the demo admins without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admins' });
    expect(res.statusCode).toBe(200);
    expect(adminsResponseSchema.parse(res.json()).items).toEqual([
      { id: 'alice', name: 'Alice Nguyen' },
      { id: 'bob', name: 'Bob Fraser' },
      { id: 'carol', name: 'Carol Smith' },
    ]);
  });
});

describe('POST /api/session', () => {
  it('replies 204 and sets an httpOnly, SameSite=Lax cookie scoped to /', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/session', payload: { adminId: 'alice' } });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    const cookie = res.cookies.find((c) => c.name === 'cac_admin');
    expect(cookie).toMatchObject({ name: 'cac_admin', value: 'alice', httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
  });

  it('rejects an unknown admin with 404 NOT_FOUND and sets no cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/session', payload: { adminId: 'mallory' } });
    expect(res.statusCode).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it.each([{}, { adminId: '' }, { adminId: 42 }])('rejects body %j with 400 VALIDATION_ERROR', async (payload) => {
    const res = await app.inject({ method: 'POST', url: '/api/session', payload });
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('treats SQL metacharacters in adminId as data, not SQL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { adminId: "alice' OR '1'='1" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/session', () => {
  it('clears the cookie and replies 204', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { cookie: 'cac_admin=alice' },
    });
    expect(res.statusCode).toBe(204);
    const cookie = res.cookies.find((c) => c.name === 'cac_admin');
    expect(cookie?.value).toBe('');
    expect(cookie?.path).toBe('/');
    expect(cookie?.expires).toBeInstanceOf(Date);
    expect((cookie?.expires as Date).getTime()).toBeLessThan(Date.now());
  });

  it('works without a cookie', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/session' });
    expect(res.statusCode).toBe(204);
  });
});
