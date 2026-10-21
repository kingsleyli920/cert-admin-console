import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorResponseSchema } from '@cac/shared';
import { startRealServer, type RealServer } from '../../server/test/helpers/real-server';
import { ApiError, createApiClient } from '../../web/src/api/client';

describe('web API client against the real server', () => {
  let server: RealServer;
  beforeAll(async () => {
    server = await startRealServer();
  });
  afterAll(() => server.stop());

  it('getHealth returns the parsed health response', async () => {
    const api = createApiClient({ baseUrl: server.url });
    await expect(api.getHealth()).resolves.toEqual({ status: 'ok' });
  });

  it('turns the server error envelope for an unknown route into an ApiError', async () => {
    // Pointing baseUrl at a bogus prefix makes /api/health an unknown route.
    const api = createApiClient({ baseUrl: `${server.url}/missing` });
    const err = await api.getHealth().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    const apiError = err as ApiError;
    expect(apiError.status).toBe(404);
    // The same body the client parsed must satisfy the shared contract schema.
    const raw = await (await fetch(`${server.url}/missing/api/health`)).json();
    expect(errorResponseSchema.parse(raw).error).toEqual({
      code: apiError.code,
      message: apiError.message,
    });
    expect(apiError.code).toBe('NOT_FOUND');
  });
});
