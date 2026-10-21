import { describe, expect, it, vi } from 'vitest';
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
});
