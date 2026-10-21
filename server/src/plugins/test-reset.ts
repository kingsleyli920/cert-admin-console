import type { FastifyInstance } from 'fastify';
import { resetDatabase } from '../db/open';
import type { BulkIssueRunner } from '../modules/bulk-issue/runner';

/** Test-only: put the database back to its seeded state. Only registered when APP_ENV=test. */
export async function testResetRoute(app: FastifyInstance, opts: { runner: BulkIssueRunner }): Promise<void> {
  app.post('/api/__test__/reset', async (_request, reply) => {
    await opts.runner.drain(); // no bulk-issue loop may touch the reseeded database
    resetDatabase(app.db);
    return reply.code(204).send();
  });
}
