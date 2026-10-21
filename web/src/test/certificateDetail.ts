import type { AdminSummary, AuditEntry, CertificateDetail } from '@cac/shared';
import { http, HttpResponse } from 'msw';
import { DST_EDGE } from './certificates';
import { alice, carol } from './fixtures';
import { server } from './msw';

export const REVOKED_AT = '2026-04-06T02:15:00.000Z'; // Sydney: 6 Apr 2026, 12:15 pm AEST

const issueEntry = (id: number, certificateId: number, runId: number | null): AuditEntry => ({
  id,
  action: 'ISSUE',
  actor: alice,
  createdAt: DST_EDGE,
  certificateId,
  courseId: 1,
  learnerId: 1000,
  runId,
});

/** HHT's valid DST-edge certificate (Sydney 5 Apr 2026, 1:30 am AEDT), issued by alice in run 77. */
export const validHht: CertificateDetail = {
  id: 100,
  serial: 'HHT-2026-000100',
  learnerId: 1000,
  learnerName: 'Emma Wilson',
  courseId: 1,
  courseTitle: 'Fire Safety 2026',
  issuedAt: DST_EDGE,
  status: 'valid',
  issuedBy: alice,
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
  audit: [issueEntry(1, 100, 77)],
};

/** HHT certificate issued by alice and revoked by carol. */
export const revokedHht: CertificateDetail = {
  ...validHht,
  id: 101,
  serial: 'HHT-2026-000101',
  learnerId: 1001,
  learnerName: 'Noah Patel',
  status: 'revoked',
  revokedAt: REVOKED_AT,
  revokedBy: carol,
  revokeReason: 'Issued to the wrong learner',
  audit: [
    issueEntry(2, 101, 77),
    {
      id: 3,
      action: 'REVOKE',
      actor: carol,
      createdAt: REVOKED_AT,
      certificateId: 101,
      courseId: 1,
      learnerId: 1001,
      runId: null,
    },
  ],
};

/** SRA's certificate at the same UTC instant (Perth 4 Apr 2026, 10:30 pm AWST). */
export const validSra: CertificateDetail = {
  ...validHht,
  id: 200,
  serial: 'SRA-2026-000200',
  learnerId: 2000,
  courseId: 4,
  courseTitle: 'Working at Heights',
  audit: [{ ...issueEntry(4, 200, 90), courseId: 4, learnerId: 2000 }],
};

function applyRevoke(cert: CertificateDetail, actor: AdminSummary, reason: string) {
  const at = '2026-04-07T01:00:00.000Z';
  cert.status = 'revoked';
  cert.revokedAt = at;
  cert.revokedBy = actor;
  cert.revokeReason = reason;
  cert.audit.push({
    id: 900 + cert.audit.length,
    action: 'REVOKE',
    actor,
    createdAt: at,
    certificateId: cert.id,
    courseId: cert.courseId,
    learnerId: cert.learnerId,
    runId: null,
  });
}

export interface DetailBackend {
  /** Parsed JSON body of every revoke POST, in order. */
  revokes: unknown[];
  /** Number of detail GETs. */
  detailRequests: number;
  /** While set, revoke POSTs fail with this status/code/message. */
  failRevoke?: { status: number; code: string; message: string };
  /** While set, detail GETs fail with a 500 carrying this message. */
  failDetail?: string;
  /** When set, the next revoke finds the certificate already revoked by carol (a concurrent admin). */
  revokeElsewhere?: boolean;
  /** The actor recorded on a successful revoke. */
  actor: typeof alice;
}

/**
 * Stateful MSW handlers for certificate detail + revoke of HHT (1) and SRA (2).
 * `certs[tid]` is the tenant's table; ids from another tenant answer 404 like the server.
 */
export function mockDetailBackend(
  opts: { certs?: Record<number, CertificateDetail[]>; revokeDelayMs?: number } = {},
): DetailBackend {
  const certs: Record<number, CertificateDetail[]> = opts.certs ?? {
    1: [structuredClone(validHht), structuredClone(revokedHht)],
    2: [structuredClone(validSra)],
  };
  const backend: DetailBackend = { revokes: [], detailRequests: 0, actor: alice };
  const notFound = () =>
    HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
  const find = (tid: unknown, id: unknown) =>
    certs[Number(tid)]?.find((c) => String(c.id) === String(id));

  server.use(
    http.get('/api/tenants/:tid/certificates/:id', ({ params }) => {
      backend.detailRequests++;
      if (backend.failDetail) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: backend.failDetail } },
          { status: 500 },
        );
      }
      const cert = find(params.tid, params.id);
      return cert ? HttpResponse.json(cert) : notFound();
    }),
    http.post('/api/tenants/:tid/certificates/:id/revoke', async ({ params, request }) => {
      const body: unknown = await request.json();
      backend.revokes.push(body);
      if (opts.revokeDelayMs) await new Promise((r) => setTimeout(r, opts.revokeDelayMs));
      if (backend.failRevoke) {
        const { status, code, message } = backend.failRevoke;
        return HttpResponse.json({ error: { code, message } }, { status });
      }
      const cert = find(params.tid, params.id);
      if (!cert) return notFound();
      if (backend.revokeElsewhere && cert.status === 'valid') applyRevoke(cert, carol, 'Duplicate');
      if (cert.status === 'revoked') {
        return HttpResponse.json(
          { error: { code: 'ALREADY_REVOKED', message: 'Certificate already revoked' } },
          { status: 409 },
        );
      }
      applyRevoke(cert, backend.actor, (body as { reason: string }).reason);
      return HttpResponse.json(cert);
    }),
  );
  return backend;
}
