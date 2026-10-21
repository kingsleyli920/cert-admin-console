import type { DatabaseSync } from 'node:sqlite';
import type { CertificateListItem, CertificateListQuery } from '@cac/shared';
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
