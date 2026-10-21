import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { adminsResponseSchema, signInRequestSchema } from '@cac/shared';
import { NotFoundError } from '../../plugins/errors';
import { findAdmin, listAdmins } from './repo';

export const SESSION_COOKIE = 'cac_admin';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/admins',
    { schema: { response: { 200: adminsResponseSchema } } },
    async () => ({ items: listAdmins(app.db) }),
  );

  app.post<{ Body: z.infer<typeof signInRequestSchema> }>(
    '/api/session',
    { schema: { body: signInRequestSchema } },
    async (request, reply) => {
      const admin = findAdmin(app.db, request.body.adminId);
      if (!admin) throw new NotFoundError('Admin not found');
      reply.setCookie(SESSION_COOKIE, admin.id, { httpOnly: true, sameSite: 'lax', path: '/' });
      return reply.code(204).send();
    },
  );

  app.delete('/api/session', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
