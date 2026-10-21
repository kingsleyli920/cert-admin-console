import type { DatabaseSync } from 'node:sqlite';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { healthResponseSchema } from '@cac/shared';
import { bulkIssueRoutes } from './modules/bulk-issue/routes';
import { BulkIssueRunner, type RunnerFaults } from './modules/bulk-issue/runner';
import { certificateRoutes, type CertificateFaults } from './modules/certificates/routes';
import { courseRoutes } from './modules/courses/routes';
import { sessionRoutes } from './modules/session/routes';
import { registerErrorHandling } from './plugins/errors';
import { registerSessionGuard } from './plugins/session';
import { testResetRoute } from './plugins/test-reset';
import { zodSerializerCompiler, zodValidatorCompiler } from './plugins/zod';

export interface BuildAppOptions {
  db: DatabaseSync;
  /** File path `db` was opened from; exports open their own read connection on it. Absent = in-memory. */
  dbPath?: string;
  now?: () => Date;
  appEnv?: string;
  delayMs?: number;
  logger?: boolean;
  /** Test-only fault injection into the bulk-issue runner. */
  faults?: RunnerFaults;
  /** Test-only fault injection into the certificate revoke transaction. */
  certificateFaults?: CertificateFaults;
}

export async function buildApp(opts: BuildAppOptions) {
  const app = Fastify({ logger: opts.logger ?? false });

  app.decorate('db', opts.db);
  app.decorate('dbPath', opts.dbPath ?? ':memory:');
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
  await app.register(certificateRoutes, { faults: opts.certificateFaults });
  await app.register(courseRoutes);
  const runner = new BulkIssueRunner(app, opts.faults);
  // preClose (not onClose): the runner must stop before any onClose hook closes the database.
  app.addHook('preClose', async () => runner.stop());
  app.addHook('onReady', async () => runner.resumeAll());
  await app.register(bulkIssueRoutes, { runner });
  if (app.appEnv === 'test') await app.register(testResetRoute, { runner });

  return app;
}
