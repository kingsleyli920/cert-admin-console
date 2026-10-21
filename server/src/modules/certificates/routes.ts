import type { FastifyInstance } from 'fastify';
import {
  certificateDetailSchema,
  certificateListQuerySchema,
  certificateListResponseSchema,
  type CertificateListQuery,
} from '@cac/shared';
import { NotFoundError } from '../../plugins/errors';
import { requireTenant } from '../../plugins/session';
import { getCertificateDetail, listCertificates } from './repo';

/** Strict positive safe integer; anything else is "no such certificate" (404), never a 400. */
function parseCertificateId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

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

  app.get<{ Params: { tid: string; id: string } }>(
    '/api/tenants/:tid/certificates/:id',
    { schema: { response: { 200: certificateDetailSchema } } },
    async (request) => {
      const id = parseCertificateId(request.params.id);
      const detail = id === null ? undefined : getCertificateDetail(app.db, requireTenant(request).id, id);
      if (!detail) throw new NotFoundError('Certificate not found');
      return detail;
    },
  );
}
