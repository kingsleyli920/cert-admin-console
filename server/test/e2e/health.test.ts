import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorResponseSchema, healthResponseSchema } from '@cac/shared';
import { startRealServer, type RealServer } from '../helpers/real-server';

describe('real server process', () => {
  let server: RealServer;
  beforeAll(async () => {
    server = await startRealServer();
  });
  afterAll(() => server.stop());

  it('serves GET /api/health over HTTP', async () => {
    const res = await fetch(`${server.url}/api/health`);
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(await res.json())).toEqual({ status: 'ok' });
  });

  it('uses the error envelope for unknown routes', async () => {
    const res = await fetch(`${server.url}/api/nope`);
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe('NOT_FOUND');
  });
});
