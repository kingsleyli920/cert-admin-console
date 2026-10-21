import Fastify from 'fastify';
import { healthResponseSchema } from '@cac/shared';
import { registerErrorHandling } from './plugins/errors';
import { zodSerializerCompiler, zodValidatorCompiler } from './plugins/zod';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  app.setValidatorCompiler(zodValidatorCompiler);
  app.setSerializerCompiler(zodSerializerCompiler);
  registerErrorHandling(app);

  app.get(
    '/api/health',
    { schema: { response: { 200: healthResponseSchema } } },
    async () => ({ status: 'ok' as const }),
  );

  return app;
}
