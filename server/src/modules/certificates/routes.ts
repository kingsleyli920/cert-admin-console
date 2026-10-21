import type { FastifyInstance } from 'fastify';
import {
  certificateListQuerySchema,
  certificateListResponseSchema,
  type CertificateListQuery,
} from '@cac/shared';
import { requireTenant } from '../../plugins/session';
import { listCertificates } from './repo';

export async function certificateRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: CertificateListQuery }>(
    '/api/tenants/:tid/certificates',
    {
      schema: {
        querystring: certificateListQuerySchema,
        response: { 200: certificateListResponseSchema },
      },
    },
    async (request) => {
      const query = request.query;
      const { items, total } = listCertificates(app.db, requireTenant(request).id, query);
      return { items, total, page: query.page, pageSize: query.pageSize };
    },
  );
}
