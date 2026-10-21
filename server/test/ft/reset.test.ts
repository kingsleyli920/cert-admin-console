import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { errorResponseSchema } from '@cac/shared';
import { buildTestApp } from '../helpers/app';

const certCount = (app: FastifyInstance): number =>
  (app.db.prepare('SELECT COUNT(*) AS n FROM certificates').get() as { n: number }).n;

describe('POST /api/__test__/reset', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  it('restores the seeded state after a certificate was deleted', async () => {
    app = await buildTestApp({ appEnv: 'test' });
    app.db.exec('DELETE FROM audit_logs WHERE certificate_id = 45');
    app.db.exec('DELETE FROM certificates WHERE id = 45');
    expect(certCount(app)).toBe(8059);

    const res = await app.inject({ method: 'POST', url: '/api/__test__/reset' });

    expect(res.statusCode).toBe(204);
    expect(certCount(app)).toBe(8060);
    expect(
      app.db.prepare('SELECT serial FROM certificates WHERE id = 45').get(),
    ).toEqual({ serial: 'HHT-2026-000037' });
  });

  it('needs no session, so UI tests can call it before signing in', async () => {
    app = await buildTestApp({ appEnv: 'test' });
    const res = await app.inject({ method: 'POST', url: '/api/__test__/reset' });
    expect(res.statusCode).toBe(204);
  });

  it.each(['development', 'production'])('does not exist when appEnv is %s', async (appEnv) => {
    app = await buildTestApp({ appEnv });
    app.db.exec('DELETE FROM audit_logs WHERE certificate_id = 45');
    app.db.exec('DELETE FROM certificates WHERE id = 45');

    const res = await app.inject({ method: 'POST', url: '/api/__test__/reset' });

    expect(res.statusCode).toBe(404);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
    expect(certCount(app)).toBe(8059); // nothing was reset
  });

  it('answers 500 and keeps the data when the reset fails', async () => {
    app = await buildTestApp({ appEnv: 'test' });
    app.db.exec("CREATE TRIGGER boom BEFORE INSERT ON courses BEGIN SELECT RAISE(ABORT, 'nope'); END");
    const res = await app.inject({ method: 'POST', url: '/api/__test__/reset' });
    expect(res.statusCode).toBe(500);
    expect(certCount(app)).toBe(8060);
  });
});
