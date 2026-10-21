import type { DatabaseSync } from 'node:sqlite';
import type { AuditEntry, CertificateDetail, CertificateListItem, CertificateListQuery } from '@cac/shared';
import { buildCertificateQuery } from './query';

interface ListRow {
  id: number;
  serial: string;
  learner_id: number;
  learner_name: string;
  course_id: number;
  course_title: string;
  issued_at: string;
  status: 'valid' | 'revoked';
}

export interface CertificatePage {
  items: CertificateListItem[];
  total: number;
}

/** One COUNT plus one page query over the shared filter/sort builder. */
export function listCertificates(
  db: DatabaseSync,
  tenantId: number,
  query: CertificateListQuery,
): CertificatePage {
  const { page, pageSize, ...filters } = query;
  const q = buildCertificateQuery(tenantId, filters);

  const { total } = db.prepare(`SELECT COUNT(*) AS total ${q.from} WHERE ${q.where}`).get(...q.params) as {
    total: number;
  };

  const rows = db
    .prepare(
      `SELECT c.id, c.serial, c.learner_id, l.name AS learner_name, c.course_id,
              co.title AS course_title, c.issued_at, c.status
         ${q.from}
        WHERE ${q.where}
        ORDER BY ${q.orderBy}
        LIMIT ? OFFSET ?`,
    )
    .all(...q.params, pageSize, (page - 1) * pageSize) as unknown as ListRow[];

  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      serial: r.serial,
      learnerId: r.learner_id,
      learnerName: r.learner_name,
      courseId: r.course_id,
      courseTitle: r.course_title,
      issuedAt: r.issued_at,
      status: r.status,
    })),
  };
}

interface DetailRow extends ListRow {
  issued_by: string;
  issued_by_name: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_by_name: string | null;
  revoke_reason: string | null;
}

interface AuditRow {
  id: number;
  action: 'ISSUE' | 'REVOKE';
  actor_id: string;
  actor_name: string;
  created_at: string;
  certificate_id: number;
  course_id: number;
  learner_id: number;
  run_id: number | null;
}

/**
 * One certificate of the tenant with its audit timeline (oldest first, ties by id), or
 * `undefined` when it does not exist in this tenant. A certificate of another tenant is
 * indistinguishable from a missing one.
 */
export function getCertificateDetail(
  db: DatabaseSync,
  tenantId: number,
  certificateId: number,
): CertificateDetail | undefined {
  const r = db
    .prepare(
      `SELECT c.id, c.serial, c.learner_id, l.name AS learner_name, c.course_id,
              co.title AS course_title, c.issued_at, c.status,
              c.issued_by, ib.name AS issued_by_name,
              c.revoked_at, c.revoked_by, rb.name AS revoked_by_name, c.revoke_reason
         FROM certificates c
         JOIN learners l ON l.id = c.learner_id AND l.tenant_id = c.tenant_id
         JOIN courses co ON co.id = c.course_id AND co.tenant_id = c.tenant_id
         JOIN admins ib ON ib.id = c.issued_by
         LEFT JOIN admins rb ON rb.id = c.revoked_by
        WHERE c.id = ? AND c.tenant_id = ?`,
    )
    .get(certificateId, tenantId) as unknown as DetailRow | undefined;
  if (!r) return undefined;

  const audit = db
    .prepare(
      `SELECT a.id, a.action, a.actor_id, ac.name AS actor_name, a.created_at,
              a.certificate_id, a.course_id, a.learner_id, a.run_id
         FROM audit_logs a
         JOIN admins ac ON ac.id = a.actor_id
        WHERE a.certificate_id = ? AND a.tenant_id = ?
        ORDER BY a.created_at ASC, a.id ASC`,
    )
    .all(certificateId, tenantId) as unknown as AuditRow[];

  return {
    id: r.id,
    serial: r.serial,
    learnerId: r.learner_id,
    learnerName: r.learner_name,
    courseId: r.course_id,
    courseTitle: r.course_title,
    issuedAt: r.issued_at,
    status: r.status,
    issuedBy: { id: r.issued_by, name: r.issued_by_name },
    revokedAt: r.revoked_at,
    revokedBy: r.revoked_by && r.revoked_by_name ? { id: r.revoked_by, name: r.revoked_by_name } : null,
    revokeReason: r.revoke_reason,
    audit: audit.map(
      (a): AuditEntry => ({
        id: a.id,
        action: a.action,
        actor: { id: a.actor_id, name: a.actor_name },
        createdAt: a.created_at,
        certificateId: a.certificate_id,
        courseId: a.course_id,
        learnerId: a.learner_id,
        runId: a.run_id,
      }),
    ),
  };
}
