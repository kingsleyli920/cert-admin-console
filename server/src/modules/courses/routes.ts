import type { FastifyInstance } from 'fastify';
import { coursesResponseSchema } from '@cac/shared';
import { requireTenant } from '../../plugins/session';
import { listCoursesWithCounts } from './repo';

export async function courseRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/tenants/:tid/courses',
    { schema: { response: { 200: coursesResponseSchema } } },
    async (request) => ({ items: listCoursesWithCounts(app.db, requireTenant(request).id) }),
  );
}
