import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { errorResponseSchema, healthResponseSchema } from '@cac/shared';
import { buildApp } from '../../src/app';
import {
  ConflictError,
  IdempotencyKeyReusedError,
  NotFoundError,
  UnauthorizedError,
} from '../../src/plugins/errors';

describe('GET /api/health', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
  });
  afterEach(() => app.close());

  it('returns 200 with { status: "ok" }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(healthResponseSchema.parse(res.json())).toEqual({ status: 'ok' });
  });

  it('returns the error envelope with 404 NOT_FOUND for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('error handler', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await buildApp();
    app.get('/t/not-found', async () => {
      throw new NotFoundError('Certificate not found');
    });
    app.get('/t/conflict', async () => {
      throw new ConflictError('Already revoked');
    });
    app.get('/t/key-reused', async () => {
      throw new IdempotencyKeyReusedError();
    });
    app.get('/t/unauthorized', async () => {
      throw new UnauthorizedError();
    });
    app.get('/t/zod', async () => {
      z.object({ n: z.number() }).parse({ n: 'x' });
    });
    app.get('/t/boom', async () => {
      throw new Error('secret db path /var/lib/app.db');
    });
    app.post('/t/echo', async (req) => req.body);
  });
  afterEach(() => app.close());

  it.each([
    ['/t/not-found', 404, 'NOT_FOUND', 'Certificate not found'],
    ['/t/conflict', 409, 'ALREADY_REVOKED', 'Already revoked'],
    ['/t/key-reused', 422, 'IDEMPOTENCY_KEY_REUSED', undefined],
    ['/t/unauthorized', 401, 'UNAUTHORIZED', undefined],
    ['/t/zod', 400, 'VALIDATION_ERROR', undefined],
  ])('maps %s to %i %s', async (url, status, code, message) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(status);
    const body = errorResponseSchema.parse(res.json());
    expect(body.error.code).toBe(code);
    if (message) expect(body.error.message).toBe(message);
  });

  it('maps unexpected errors to 500 INTERNAL_ERROR without leaking internals', async () => {
    const res = await app.inject({ method: 'GET', url: '/t/boom' });
    expect(res.statusCode).toBe(500);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('secret');
    expect(res.body).not.toContain('app.db');
  });

  it('maps malformed JSON bodies to 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/t/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('BAD_REQUEST');
  });
});
