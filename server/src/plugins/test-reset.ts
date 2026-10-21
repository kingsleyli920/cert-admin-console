import type { FastifyInstance } from 'fastify';
import { resetDatabase } from '../db/open';

/** Test-only: put the database back to its seeded state. Only registered when APP_ENV=test. */
export async function testResetRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/__test__/reset', async (_request, reply) => {
    resetDatabase(app.db);
    return reply.code(204).send();
  });
}
