import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import {
  certificateDetailSchema,
  certificateListQuerySchema,
  certificateListResponseSchema,
  revokeRequestSchema,
  type CertificateListQuery,
} from '@cac/shared';
import { NotFoundError } from '../../plugins/errors';
import { requireAdmin, requireTenant } from '../../plugins/session';
import { certificateCsvStream, exportFileName } from './export';
import { getCertificateDetail, listCertificates, revokeCertificate } from './repo';

type RevokeRequest = z.infer<typeof revokeRequestSchema>;

/**
 * Test-only fault injection (set via `buildApp({ certificateFaults })`); never set in production.
 * Mutable on purpose so a test can arm it after the app is built.
 */
export interface CertificateFaults {
  /** Called inside the revoke transaction right before the audit INSERT. May throw. */
  beforeRevokeAudit?: () => void;
}

/** Strict positive safe integer; anything else is "no such certificate" (404), never a 400. */
function parseCertificateId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export async function certificateRoutes(app: FastifyInstance, opts: { faults?: CertificateFaults } = {}): Promise<void> {
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

  // Static segment: find-my-way prefers it over the `/:id` route below, whatever the order.
  app.get<{ Querystring: CertificateListQuery }>(
    '/api/tenants/:tid/certificates/export.csv',
    { schema: { querystring: certificateListQuerySchema } },
    async (request, reply) => {
      const tenant = requireTenant(request);
      const { page: _page, pageSize: _pageSize, ...filters } = request.query; // export is not paginated
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${exportFileName(tenant, app.now())}"`)
        .header('cache-control', 'no-store')
        .send(certificateCsvStream(app.db, app.dbPath, tenant, filters));
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

  app.post<{ Params: { tid: string; id: string }; Body: RevokeRequest }>(
    '/api/tenants/:tid/certificates/:id/revoke',
    { schema: { body: revokeRequestSchema, response: { 200: certificateDetailSchema } } },
    async (request) => {
      const id = parseCertificateId(request.params.id);
      if (id === null) throw new NotFoundError('Certificate not found');
      return revokeCertificate(app.db, requireTenant(request).id, id, {
        actorId: requireAdmin(request).id,
        at: app.now().toISOString(),
        reason: request.body.reason,
        beforeAudit: () => opts.faults?.beforeRevokeAudit?.(),
      });
    },
  );
}
