import type { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CertificateListQuery } from '@cac/shared';
import { buildCertificateQuery } from '../../src/modules/certificates/query';
import { SEED_IDS } from '../../src/db/seed';
import { createTestDb } from '../helpers/db';

const { hht: HHT, sra: SRA, nhi: NHI, lcl: LCL } = SEED_IDS.tenants;

type Filters = Parameters<typeof buildCertificateQuery>[1];
const defaults: Filters = { sort: 'issuedAt', order: 'desc' };

interface Row {
  id: number;
  tenant_id: number;
  serial: string;
  learner_id: number;
  learner_name: string;
  course_id: number;
}

let db: DatabaseSync;
beforeAll(() => {
  db = createTestDb();
});
afterAll(() => db.close());

/** Runs the built clauses in a real SELECT, exactly as the repo does. */
function run(tenantId: number, filters: Partial<Filters> = {}): Row[] {
  const q = buildCertificateQuery(tenantId, { ...defaults, ...filters });
  const sql = `SELECT c.id, c.tenant_id, c.serial, c.learner_id, l.name AS learner_name, c.course_id
                 ${q.from} WHERE ${q.where} ORDER BY ${q.orderBy}`;
  return db.prepare(sql).all(...q.params) as unknown as Row[];
}

describe('buildCertificateQuery: tenant scoping', () => {
  it('always puts the tenant condition first', () => {
    const q = buildCertificateQuery(HHT, { ...defaults, q: 'x', status: 'valid', courseId: 101 });
    expect(q.where.startsWith('c.tenant_id = ?')).toBe(true);
    expect(q.params[0]).toBe(HHT);
  });

  it('returns only the requested tenant, with no filters', () => {
    const rows = run(HHT);
    expect(rows).toHaveLength(45);
    expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([HHT]));
    expect(run(SRA)).toHaveLength(15);
    expect(run(LCL)).toHaveLength(8000);
    expect(run(NHI)).toHaveLength(0);
  });

  it('yields no rows for a course that belongs to another tenant', () => {
    expect(run(HHT, { courseId: SEED_IDS.courses.sraFoodSafetyBasics })).toEqual([]);
  });

  it('keeps the tenant filter when a search matches another tenant\'s learner', () => {
    expect(run(NHI, { q: 'Emma Wilson' })).toEqual([]);
  });
});

describe('buildCertificateQuery: search', () => {
  it.each(['%', '_', '\\', '%%', 'E_ma', 'Em%'])('treats %j literally (matches nothing in HHT)', (q) => {
    expect(run(HHT, { q })).toEqual([]);
  });

  it.each(['wilson', 'WILSON', 'Wilson', 'ilson', '  wilson  '])(
    'matches a learner-name substring case-insensitively (%j)',
    (q) => {
      const rows = run(HHT, { q });
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.learner_id))).toEqual(new Set([SEED_IDS.learners.emmaWilsonHht]));
      expect(rows.every((r) => r.learner_name === 'Emma Wilson')).toBe(true);
    },
  );

  it('matches a name containing an apostrophe', () => {
    const rows = run(HHT, { q: "o'connor" });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.learner_name))).toEqual(new Set(["Liam O'Connor"]));
  });

  it('matches an exact serial, in lower case too', () => {
    expect(run(HHT, { q: 'HHT-2026-000037' }).map((r) => r.id)).toEqual([SEED_IDS.certificates.hhtDstEdge]);
    expect(run(HHT, { q: 'hht-2026-000037' }).map((r) => r.id)).toEqual([SEED_IDS.certificates.hhtDstEdge]);
  });

  it('matches serials by prefix, case-insensitively', () => {
    const upper = run(HHT, { q: 'HHT-2026-0000' });
    const lower = run(HHT, { q: 'hht-2026-0000' });
    expect(upper.length).toBeGreaterThan(1);
    expect(upper.every((r) => r.serial.startsWith('HHT-2026-0000'))).toBe(true);
    expect(lower.map((r) => r.id)).toEqual(upper.map((r) => r.id));
  });

  it('does not match a serial by a middle fragment', () => {
    expect(run(HHT, { q: '2026-000037' })).toEqual([]);
  });

  it('ignores a blank search', () => {
    expect(run(HHT, { q: '   ' })).toHaveLength(45);
  });

  it('is not injectable', () => {
    expect(run(HHT, { q: "' OR 1=1 --" })).toEqual([]);
  });
});

describe('buildCertificateQuery: filters', () => {
  it('filters by course', () => {
    expect(run(HHT, { courseId: SEED_IDS.courses.fireSafety2026, order: 'asc', sort: 'serial' }).map((r) => r.id).sort()).toEqual([1, 2, 3]);
  });

  it('filters by status', () => {
    const ids = run(HHT, { status: 'revoked' }).map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([3, 11, 34]);
  });

  it('combines filters with AND', () => {
    expect(run(HHT, { status: 'revoked', courseId: 101 }).map((r) => r.id)).toEqual([3]);
  });
});

describe('buildCertificateQuery: ordering', () => {
  it('orders by issued_at then id in the same direction', () => {
    const q = buildCertificateQuery(HHT, { ...defaults, order: 'asc' });
    expect(q.orderBy).toBe('c.issued_at ASC, c.id ASC');
    expect(buildCertificateQuery(HHT, defaults).orderBy).toBe('c.issued_at DESC, c.id DESC');
  });

  it.each<[CertificateListQuery['sort'], string]>([
    ['issuedAt', 'c.issued_at'],
    ['learnerName', 'l.name COLLATE NOCASE'],
    ['courseTitle', 'co.title COLLATE NOCASE'],
    ['serial', 'c.serial'],
  ])('maps sort=%s to %s', (sort, column) => {
    expect(buildCertificateQuery(HHT, { sort, order: 'desc' }).orderBy).toBe(`${column} DESC, c.id DESC`);
  });

  it('sorts by serial ascending', () => {
    const serials = run(HHT, { sort: 'serial', order: 'asc' }).map((r) => r.serial);
    expect(serials[0]).toBe('HHT-2025-000001');
    expect(serials).toEqual([...serials].sort());
  });

  it.each(['bogus', 'issued_at', 'c.id; DROP TABLE certificates', 'constructor', '__proto__', ''])(
    'throws on an unknown sort key %j instead of interpolating it',
    (sort) => {
      expect(() => buildCertificateQuery(HHT, { sort, order: 'asc' } as unknown as Filters)).toThrow(/sort/i);
    },
  );

  it.each(['up', 'ASC; --', 'toString', ''])('throws on an unknown order %j', (order) => {
    expect(() => buildCertificateQuery(HHT, { sort: 'serial', order } as unknown as Filters)).toThrow(/order/i);
  });
});
