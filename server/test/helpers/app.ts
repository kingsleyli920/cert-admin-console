import type { FastifyInstance } from 'fastify';
import { buildApp, type BuildAppOptions } from '../../src/app';
import { createTestDb } from './db';

/**
 * Builds the app on a fresh seeded in-memory DB (appEnv "test", no delay).
 * The DB is reachable as `app.db`; it is closed together with the app unless the
 * caller supplied its own.
 */
export async function buildTestApp(overrides: Partial<BuildAppOptions> = {}): Promise<FastifyInstance> {
  const ownsDb = overrides.db === undefined;
  const app = await buildApp({
    appEnv: 'test',
    delayMs: 0,
    ...overrides,
    db: overrides.db ?? createTestDb(),
  });
  if (ownsDb) app.addHook('onClose', async () => app.db.close());
  return app;
}

/** Signs in through the real endpoint and returns the value for a `cookie` request header. */
export async function signIn(app: FastifyInstance, adminId: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/session', payload: { adminId } });
  if (res.statusCode !== 204) throw new Error(`sign-in as ${adminId} failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'cac_admin');
  if (!cookie) throw new Error('sign-in did not set cac_admin');
  return `${cookie.name}=${cookie.value}`;
}
