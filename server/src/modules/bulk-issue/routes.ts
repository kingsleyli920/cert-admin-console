import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bulkIssueRunResponseSchema, idempotencyKeySchema } from '@cac/shared';
import { IdempotencyKeyReusedError, NotFoundError } from '../../plugins/errors';
import { requireAdmin, requireTenant } from '../../plugins/session';
import { courseExists, createRun, findRun, getRunView } from './repo';
import type { BulkIssueRunner } from './runner';

const issueHeadersSchema = z.object({ 'idempotency-key': idempotencyKeySchema });

/** Strict positive integer; anything else is "no such resource" (404), never a 400. */
function parseId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export interface BulkIssueRoutesOptions {
  runner: BulkIssueRunner;
}

export async function bulkIssueRoutes(app: FastifyInstance, opts: BulkIssueRoutesOptions): Promise<void> {
  const { runner } = opts;

  app.post(
    '/api/tenants/:tid/courses/:cid/bulk-issue',
    { schema: { headers: issueHeadersSchema, response: { 202: bulkIssueRunResponseSchema } } },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const admin = requireAdmin(request);
      const courseId = parseId((request.params as { cid?: string }).cid);
      if (courseId === null || !courseExists(app.db, tenant.id, courseId)) throw new NotFoundError('Course not found');

      const result = createRun(app.db, tenant.id, {
        courseId,
        idempotencyKey: (request.headers as Record<string, string>)['idempotency-key'],
        createdBy: admin.id,
        createdAt: app.now().toISOString(),
      });
      if (result.kind === 'key_reused') throw new IdempotencyKeyReusedError();

      const run = getRunView(app.db, tenant.id, result.runId);
      const row = findRun(app.db, tenant.id, result.runId);
      if (!run || !row) throw new Error('run vanished after creation');
      runner.start(row); // not awaited; a no-op if the run is completed or already being processed
      return reply.code(202).send({ run });
    },
  );

  app.get(
    '/api/tenants/:tid/bulk-issue-runs/:runId',
    { schema: { response: { 200: bulkIssueRunResponseSchema } } },
    async (request) => {
      const runId = parseId((request.params as { runId?: string }).runId);
      const run = runId === null ? undefined : getRunView(app.db, requireTenant(request).id, runId);
      if (!run) throw new NotFoundError('Run not found');
      return { run };
    },
  );
}
