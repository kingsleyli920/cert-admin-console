import { describe, expect, it, vi } from 'vitest';
import { buildRun, RUN_ID } from '../test/bulkIssue';
import { ApiError, createApiClient } from './client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('createApiClient', () => {
  it('getHealth parses an ok response and sends credentials and headers', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ status: 'ok' }));
    const api = createApiClient({
      baseUrl: 'http://api.test',
      fetch,
      headers: { 'x-tenant': 'acme' },
    });

    await expect(api.getHealth()).resolves.toEqual({ status: 'ok' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/health');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('x-tenant')).toBe('acme');
  });

  it('maps a 500 JSON error envelope to ApiError', async () => {
    const fetch = async () =>
      json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500);
    const api = createApiClient({ fetch });

    const err = await api.getHealth().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  it('maps a non-JSON error response to a generic ApiError', async () => {
    const fetch = async () => new Response('<html>Bad gateway</html>', { status: 502 });
    const err = await createApiClient({ fetch })
      .getHealth()
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, code: 'UNKNOWN_ERROR' });
  });

  it('rejects a 2xx body that does not match the shared schema', async () => {
    const fetch = async () => json({ status: 'degraded' });
    const err = await createApiClient({ fetch })
      .getHealth()
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 200, code: 'INVALID_RESPONSE' });
  });

  it('maps a network failure to ApiError with status 0', async () => {
    const fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const err = await createApiClient({ fetch })
      .getHealth()
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('merges default accept, client headers and per-request headers on a POST', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    const api = createApiClient({ fetch, headers: { 'x-tenant': 'acme' } });

    await api.signIn('alice');

    const [, init] = fetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('x-tenant')).toBe('acme');
  });

  it('signIn posts the admin id as a JSON body to /api/session', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));

    await createApiClient({ fetch }).signIn('alice');

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/session');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ adminId: 'alice' });
  });

  it('signIn accepts a 200 with an empty body', async () => {
    const fetch = async () => new Response('', { status: 200 });
    await expect(createApiClient({ fetch }).signIn('alice')).resolves.toBeUndefined();
  });

  it('signOut sends DELETE /api/session and accepts 204', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));

    await expect(createApiClient({ fetch }).signOut()).resolves.toBeUndefined();

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/session');
    expect(init?.method).toBe('DELETE');
  });

  it('getAdmins and getMe parse their responses with the shared schemas', async () => {
    const admins = { items: [{ id: 'alice', name: 'Alice Nguyen' }] };
    const me = {
      admin: admins.items[0],
      tenants: [{ id: 1, code: 'HHT', name: 'Hunter Health Training', timezone: 'Australia/Sydney' }],
    };
    const fetch = async (input: RequestInfo | URL) =>
      json(String(input).endsWith('/api/admins') ? admins : me);
    const api = createApiClient({ fetch });

    await expect(api.getAdmins()).resolves.toEqual(admins);
    await expect(api.getMe()).resolves.toEqual(me);
  });

  it('getMe maps a 401 to ApiError with status 401', async () => {
    const fetch = async () =>
      json({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } }, 401);

    const err = await createApiClient({ fetch })
      .getMe()
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('signIn surfaces a non-2xx error envelope as ApiError', async () => {
    const fetch = async () =>
      json({ error: { code: 'VALIDATION_ERROR', message: 'Unknown admin' } }, 400);

    const err = await createApiClient({ fetch })
      .signIn('nobody')
      .catch((e: unknown) => e);

    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  describe('listCertificates', () => {
    const page = {
      items: [
        {
          id: 1,
          serial: 'HHT-2026-000001',
          learnerId: 7,
          learnerName: 'Emma Wilson',
          courseId: 2,
          courseTitle: 'Fire Safety 2026',
          issuedAt: '2026-04-04T14:30:00.000Z',
          status: 'valid',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    };

    it('GETs the tenant route with only the params that are set', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => json(page));

      await expect(
        createApiClient({ fetch }).listCertificates(1, {
          q: 'emma',
          courseId: 2,
          status: 'revoked',
          sort: 'learnerName',
          order: 'asc',
          page: 3,
          pageSize: 50,
        }),
      ).resolves.toEqual(page);

      const url = new URL(String(fetch.mock.calls[0]![0]), 'http://x');
      expect(url.pathname).toBe('/api/tenants/1/certificates');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        q: 'emma',
        courseId: '2',
        status: 'revoked',
        sort: 'learnerName',
        order: 'asc',
        page: '3',
        pageSize: '50',
      });
    });

    it('omits undefined and empty params and sends no "?" for an empty query', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => json(page));
      const api = createApiClient({ fetch });

      await api.listCertificates(4, { q: '', courseId: undefined, page: 2 });
      await api.listCertificates(4, {});

      expect(fetch.mock.calls[0]![0]).toBe('/api/tenants/4/certificates?page=2');
      expect(fetch.mock.calls[1]![0]).toBe('/api/tenants/4/certificates');
    });

    it('rejects a body that does not match the shared list schema', async () => {
      const fetch = async () => json({ ...page, items: [{ id: 1 }] });
      const err = await createApiClient({ fetch })
        .listCertificates(1, {})
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: 'INVALID_RESPONSE' });
    });
  });

  it('listCourses GETs /api/tenants/:tid/courses and parses the response', async () => {
    const courses = {
      items: [
        {
          id: 2,
          title: 'Fire Safety 2026',
          enrolled: 16,
          counts: { eligible: 8, alreadyIssued: 3, notCompleted: 4, inactive: 1 },
        },
      ],
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(courses));

    await expect(createApiClient({ fetch }).listCourses(1)).resolves.toEqual(courses);
    expect(fetch.mock.calls[0]![0]).toBe('/api/tenants/1/courses');
  });
  describe('bulk issue', () => {
    const KEY = '3f2b8c1e-7a4d-4e6b-9c0a-1d2e3f4a5b6c';

    it('bulkIssue POSTs to the course route with the Idempotency-Key header and returns the run', async () => {
      const run = buildRun(0);
      const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ run }, 202));

      await expect(createApiClient({ fetch }).bulkIssue(1, 5, KEY)).resolves.toEqual(run);

      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe('/api/tenants/1/courses/5/bulk-issue');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('idempotency-key')).toBe(KEY);
    });

    it('bulkIssue refuses a key that is not a UUID without sending anything', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      await expect(createApiClient({ fetch }).bulkIssue(1, 5, 'abc')).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    });

    it('bulkIssue surfaces a 422 as ApiError and a network failure as status 0', async () => {
      const reused = async () =>
        json({ error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'Key used for another course' } }, 422);
      await expect(createApiClient({ fetch: reused }).bulkIssue(1, 5, KEY)).rejects.toMatchObject({
        status: 422,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Key used for another course',
      });

      const offline = async () => {
        throw new TypeError('Failed to fetch');
      };
      await expect(createApiClient({ fetch: offline }).bulkIssue(1, 5, KEY)).rejects.toMatchObject({
        status: 0,
      });
    });

    it('getRun GETs the run route and unwraps the run', async () => {
      const run = buildRun(3);
      const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ run }));

      await expect(createApiClient({ fetch }).getRun(1, RUN_ID)).resolves.toEqual(run);

      expect(fetch.mock.calls[0]![0]).toBe(`/api/tenants/1/bulk-issue-runs/${RUN_ID}`);
    });

    it('getRun rejects a body that does not match the run schema', async () => {
      const fetch = async () => json({ run: { id: 1 } });
      await expect(createApiClient({ fetch }).getRun(1, 1)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    });
  });
});
