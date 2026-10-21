import type { SQLInputValue } from 'node:sqlite';
import type { CertificateListQuery } from '@cac/shared';

/** The list/export filters: everything in the list query except paging. */
export type CertificateFilters = Omit<CertificateListQuery, 'page' | 'pageSize'>;

export interface CertificateQuery {
  /** `FROM ... JOIN ...` clause; aliases: c = certificates, l = learners, co = courses. */
  from: string;
  /** Boolean expression with `?` placeholders; starts with the tenant condition. */
  where: string;
  /** Positional parameters for `where`, in order. */
  params: SQLInputValue[];
  /** Whitelisted `ORDER BY` expression (no keyword). */
  orderBy: string;
}

const FROM =
  'FROM certificates c ' +
  'JOIN learners l ON l.id = c.learner_id AND l.tenant_id = c.tenant_id ' +
  'JOIN courses co ON co.id = c.course_id AND co.tenant_id = c.tenant_id';

// Sort whitelist: the only way a request value ever reaches the SQL text.
const SORT_COLUMNS: Readonly<Record<CertificateFilters['sort'], string>> = {
  issuedAt: 'c.issued_at',
  learnerName: 'l.name COLLATE NOCASE',
  courseTitle: 'co.title COLLATE NOCASE',
  serial: 'c.serial',
};
const DIRECTIONS: Readonly<Record<CertificateFilters['order'], 'ASC' | 'DESC'>> = {
  asc: 'ASC',
  desc: 'DESC',
};

function lookup<T>(table: Readonly<Record<string, T>>, key: string, what: string): T {
  if (!Object.hasOwn(table, key)) throw new Error(`Unsupported ${what}: ${JSON.stringify(key)}`);
  return table[key];
}

/** Escapes LIKE wildcards so user input matches literally (pair with `ESCAPE '\'`). */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}

/**
 * Builds the WHERE / ORDER BY shared by the certificate list and the CSV export
 * (SPEC §2.6 #3). Callers add `SELECT ... ${from} WHERE ${where} ORDER BY ${orderBy}` and,
 * for the list only, `LIMIT ? OFFSET ?`. Throws on an unknown sort/order, which the
 * request schema already rules out.
 */
export function buildCertificateQuery(tenantId: number, filters: CertificateFilters): CertificateQuery {
  const column = lookup(SORT_COLUMNS, filters.sort, 'sort');
  const direction = lookup(DIRECTIONS, filters.order, 'order');

  const conditions = ['c.tenant_id = ?'];
  const params: SQLInputValue[] = [tenantId];

  const q = filters.q?.trim();
  if (q) {
    // LIKE is already ASCII case-insensitive in SQLite. Serials are stored upper-case.
    conditions.push("(l.name LIKE ? ESCAPE '\\' OR c.serial LIKE ? ESCAPE '\\')");
    params.push(`%${escapeLike(q)}%`, `${escapeLike(q.toUpperCase())}%`);
  }
  if (filters.courseId !== undefined) {
    conditions.push('c.course_id = ?');
    params.push(filters.courseId);
  }
  if (filters.status !== undefined) {
    conditions.push('c.status = ?');
    params.push(filters.status);
  }

  return {
    from: FROM,
    where: conditions.join(' AND '),
    params,
    orderBy: `${column} ${direction}, c.id ${direction}`,
  };
}
