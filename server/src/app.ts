import type { DatabaseSync } from 'node:sqlite';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { healthResponseSchema } from '@cac/shared';
import { sessionRoutes } from './modules/session/routes';
import { registerErrorHandling } from './plugins/errors';
import { registerSessionGuard } from './plugins/session';
import { testResetRoute } from './plugins/test-reset';
import { zodSerializerCompiler, zodValidatorCompiler } from './plugins/zod';

export interface BuildAppOptions {
  db: DatabaseSync;
  now?: () => Date;
  appEnv?: string;
  delayMs?: number;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions) {
  const app = Fastify({ logger: opts.logger ?? false });

  app.decorate('db', opts.db);
  app.decorate('now', opts.now ?? (() => new Date()));
  app.decorate('appEnv', opts.appEnv ?? 'development');
  app.decorate('delayMs', opts.delayMs ?? 0);

  app.setValidatorCompiler(zodValidatorCompiler);
  app.setSerializerCompiler(zodSerializerCompiler);
  registerErrorHandling(app);
  await app.register(cookie);
  registerSessionGuard(app);

  app.get(
    '/api/health',
    { schema: { response: { 200: healthResponseSchema } } },
    async () => ({ status: 'ok' as const }),
  );
  await app.register(sessionRoutes);
  if (app.appEnv === 'test') await app.register(testResetRoute);

  return app;
}
