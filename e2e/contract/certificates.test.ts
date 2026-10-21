import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  certificateListResponseSchema,
  certificateSortSchema,
  coursesResponseSchema,
  errorResponseSchema,
  sortOrderSchema,
} from '@cac/shared';
import { ACCESS_MATRIX, tenantById } from '../../server/test/helpers/access-matrix';
import { startRealServer, type RealServer } from '../../server/test/helpers/real-server';
import { ApiError, createApiClient } from '../../web/src/api/client';

let server: RealServer;
const cookies = new Map<string, string>();
beforeAll(async () => {
  server = await startRealServer();
  for (const { admin } of ACCESS_MATRIX) {
    const res = await fetch(`${server.url}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminId: admin }),
    });
    expect(res.status).toBe(204);
    cookies.set(admin, (res.headers.get('set-cookie') ?? '').split(';')[0]);
  }
});
afterAll(() => server.stop());

const cookieOf = (admin: string) => cookies.get(admin)!;
const clientFor = (admin?: string) =>
  createApiClient({ baseUrl: server.url, headers: admin ? { cookie: cookieOf(admin) } : undefined });

async function rawGet(path: string, admin?: string): Promise<Response> {
  return fetch(`${server.url}${path}`, { headers: admin ? { cookie: cookieOf(admin) } : {} });
}

// Every (admin, allowed tenant) pair; the client already parses with the shared schema, and
// the raw body is parsed again so a client-side schema change cannot hide a server change.
const ALLOWED = ACCESS_MATRIX.flatMap(({ admin, allowed }) =>
  allowed.map((tid) => ({ admin, tid, code: tenantById(tid).code })),
);

describe('listCertificates', () => {
  it.each(ALLOWED)('$admin / $code: default query parses and echoes the defaults', async ({ admin, tid }) => {
    const page = await clientFor(admin).listCertificates(tid, {});
    expect(page).toMatchObject({ page: 1, pageSize: 20 });
    expect(page.items.length).toBeLessThanOrEqual(20);

    const raw = await (await rawGet(`/api/tenants/${tid}/certificates`, admin)).json();
    expect(certificateListResponseSchema.parse(raw)).toEqual(page);
  });

  it.each(ALLOWED)('$admin / $code: every sort x order parses', async ({ admin, tid }) => {
    const api = clientFor(admin);
    for (const sort of certificateSortSchema.options) {
      for (const order of sortOrderSchema.options) {
        const page = await api.listCertificates(tid, { sort, order });
        expect(page.total, `${sort} ${order}`).toBeGreaterThanOrEqual(page.items.length);
      }
    }
  });

  it('q, status and courseId narrow the HHT list as documented', async () => {
    const api = clientFor('alice');
    const emma = await api.listCertificates(1, { q: 'Emma Wilson', pageSize: 100 });
    expect(emma.total).toBeGreaterThan(0);
    expect(new Set(emma.items.map((i) => i.learnerName))).toEqual(new Set(['Emma Wilson']));

    const revoked = await api.listCertificates(1, { status: 'revoked' });
    expect(revoked.total).toBe(3);
    expect(revoked.items.every((i) => i.status === 'revoked')).toBe(true);

    const fire = await api.listCertificates(1, { courseId: 101 });
    expect(fire.total).toBe(3);
    expect(fire.items.every((i) => i.courseId === 101)).toBe(true);
  });

  it('page and pageSize slice the LCL list for bob', async () => {
    const api = clientFor('bob');
    const first = await api.listCertificates(3, { page: 2, pageSize: 100 });
    expect(first).toMatchObject({ total: 8000, page: 2, pageSize: 100 });
    expect(first.items).toHaveLength(100);

    const last = await api.listCertificates(3, { page: 80, pageSize: 100 });
    expect(last.items).toHaveLength(100);
    expect((await api.listCertificates(3, { page: 81, pageSize: 100 })).items).toEqual([]);
  });
});

describe('listCourses', () => {
  it.each(ALLOWED)('$admin / $code: parses with non-empty courses', async ({ admin, tid }) => {
    const courses = await clientFor(admin).listCourses(tid);
    expect(courses.items.length).toBeGreaterThan(0);

    const raw = await (await rawGet(`/api/tenants/${tid}/courses`, admin)).json();
    expect(coursesResponseSchema.parse(raw)).toEqual(courses);
  });
});

describe('error responses', () => {
  async function expectApiError(fn: () => Promise<unknown>, status: number, code: string): Promise<ApiError> {
    const err = await fn().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status, code });
    return err as ApiError;
  }

  async function expectRawError(path: string, admin: string | undefined, status: number, err: ApiError) {
    const res = await rawGet(path, admin);
    expect(res.status).toBe(status);
    expect(errorResponseSchema.parse(await res.json()).error).toEqual({ code: err.code, message: err.message });
  }

  it('pageSize=101 is 400 VALIDATION_ERROR', async () => {
    const err = await expectApiError(() => clientFor('alice').listCertificates(1, { pageSize: 101 }), 400, 'VALIDATION_ERROR');
    await expectRawError('/api/tenants/1/certificates?pageSize=101', 'alice', 400, err);
  });

  it('a tenant the admin does not manage is 404 NOT_FOUND (alice on LCL)', async () => {
    const err = await expectApiError(() => clientFor('alice').listCertificates(3, {}), 404, 'NOT_FOUND');
    await expectRawError('/api/tenants/3/certificates', 'alice', 404, err);
  });

  it('courses of a tenant the admin does not manage are 404 NOT_FOUND (bob on HHT)', async () => {
    const err = await expectApiError(() => clientFor('bob').listCourses(1), 404, 'NOT_FOUND');
    await expectRawError('/api/tenants/1/courses', 'bob', 404, err);
  });

  it('no cookie is 401 UNAUTHORIZED on both routes', async () => {
    const certs = await expectApiError(() => clientFor().listCertificates(1, {}), 401, 'UNAUTHORIZED');
    await expectRawError('/api/tenants/1/certificates', undefined, 401, certs);
    const courses = await expectApiError(() => clientFor().listCourses(1), 401, 'UNAUTHORIZED');
    await expectRawError('/api/tenants/1/courses', undefined, 401, courses);
  });
});
