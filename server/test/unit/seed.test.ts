import type { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import { tenantLocalYear } from '@cac/shared';
import { migrate, openDatabase } from '../../src/db/open';
import { SEED_IDS, seed } from '../../src/db/seed';

const HHT = SEED_IDS.tenants.hht;
const SRA = SEED_IDS.tenants.sra;
const LCL = SEED_IDS.tenants.lcl;
const NHI = SEED_IDS.tenants.nhi;
const ISO_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function freshSeededDb(): { db: DatabaseSync; ms: number } {
  const db = openDatabase(':memory:');
  migrate(db);
  const startedAt = performance.now();
  seed(db);
  return { db, ms: performance.now() - startedAt };
}

describe('seed data invariants', () => {
  let db: DatabaseSync;
  let seedMs: number;
  beforeAll(() => {
    ({ db, ms: seedMs } = freshSeededDb());
  });

  const rows = <T>(sql: string, ...params: Array<string | number>): T[] =>
    db.prepare(sql).all(...params) as unknown as T[];
  const one = <T>(sql: string, ...params: Array<string | number>): T => rows<T>(sql, ...params)[0];
  const countIn = (table: string, tenantId: number): number =>
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`, tenantId).n;

  function localDate(timeZone: string, iso: string): string {
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).formatToParts(new Date(iso));
    const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    return `${pick('day')} ${pick('month')} ${pick('year')}`;
  }

  describe('row counts', () => {
    it('LCL has exactly 8000 certificates', () => {
      expect(countIn('certificates', LCL)).toBe(8000);
    });
    it('NHI has no certificates', () => {
      expect(countIn('certificates', NHI)).toBe(0);
    });
    it('LCL has 20 courses, 400 learners and 8000 enrollments', () => {
      expect(countIn('courses', LCL)).toBe(20);
      expect(countIn('learners', LCL)).toBe(400);
      expect(countIn('enrollments', LCL)).toBe(8000);
    });
    it('HHT has 4 courses and 45 certificates', () => {
      expect(countIn('courses', HHT)).toBe(4);
      expect(countIn('certificates', HHT)).toBe(45);
    });
    it('SRA has 3 courses and 15 certificates', () => {
      expect(countIn('courses', SRA)).toBe(3);
      expect(countIn('certificates', SRA)).toBe(15);
    });
    it('has exactly the 4 tenants and 3 admins with the documented ownership', () => {
      expect(rows('SELECT code, timezone FROM tenants ORDER BY id')).toEqual([
        { code: 'HHT', timezone: 'Australia/Sydney' },
        { code: 'SRA', timezone: 'Australia/Perth' },
        { code: 'LCL', timezone: 'Australia/Sydney' },
        { code: 'NHI', timezone: 'Australia/Brisbane' },
      ]);
      expect(rows('SELECT id, name FROM admins ORDER BY id')).toEqual([
        { id: 'alice', name: 'Alice Nguyen' },
        { id: 'bob', name: 'Bob Fraser' },
        { id: 'carol', name: 'Carol Smith' },
      ]);
      expect(rows('SELECT admin_id, tenant_id FROM admin_tenants ORDER BY admin_id, tenant_id')).toEqual([
        { admin_id: 'alice', tenant_id: 1 },
        { admin_id: 'alice', tenant_id: 2 },
        { admin_id: 'alice', tenant_id: 4 },
        { admin_id: 'bob', tenant_id: 3 },
        { admin_id: 'carol', tenant_id: 1 },
      ]);
    });
  });

  describe('Fire Safety 2026 (HHT) classification per spec 1.3', () => {
    type Outcome = 'issued' | 'already_issued' | 'revoked' | 'not_completed' | 'learner_inactive';
    let tally: Map<Outcome, number>;
    let total: number;
    beforeAll(() => {
      const fire = rows<{ enr_status: string; learner_status: string; cert_status: string | null }>(
        `SELECT e.status AS enr_status, l.status AS learner_status, c.status AS cert_status
           FROM enrollments e
           JOIN learners l ON l.id = e.learner_id
           LEFT JOIN certificates c
             ON c.tenant_id = e.tenant_id AND c.course_id = e.course_id AND c.learner_id = e.learner_id
          WHERE e.course_id = ? AND e.tenant_id = ?`,
        SEED_IDS.courses.fireSafety2026,
        HHT,
      );
      total = fire.length;
      tally = new Map();
      for (const r of fire) {
        let outcome: Outcome;
        if (r.cert_status === 'valid') outcome = 'already_issued';
        else if (r.cert_status === 'revoked') outcome = 'revoked';
        else if (r.enr_status !== 'completed') outcome = 'not_completed';
        else if (r.learner_status === 'inactive') outcome = 'learner_inactive';
        else outcome = 'issued';
        tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
      }
    });

    it('has 16 enrolled learners', () => expect(total).toBe(16));
    it('would issue 8', () => expect(tally.get('issued')).toBe(8));
    it('would skip 7: 2 already issued, 1 revoked, 4 not completed', () => {
      expect(tally.get('already_issued')).toBe(2);
      expect(tally.get('revoked')).toBe(1);
      expect(tally.get('not_completed')).toBe(4);
    });
    it('would fail 1 (completed but inactive learner)', () => {
      expect(tally.get('learner_inactive')).toBe(1);
    });
  });

  describe('DST-edge certificates', () => {
    it('HHT certificate 45 was issued at 2026-04-04T14:30:00.000Z', () => {
      expect(
        one('SELECT tenant_id, issued_at FROM certificates WHERE id = ?', SEED_IDS.certificates.hhtDstEdge),
      ).toEqual({ tenant_id: HHT, issued_at: '2026-04-04T14:30:00.000Z' });
    });
    it('HHT certificate 45 falls on 5 Apr 2026 in Sydney', () => {
      expect(localDate('Australia/Sydney', '2026-04-04T14:30:00.000Z')).toBe('5 Apr 2026');
    });
    it('SRA certificate 115 was issued at the same instant', () => {
      expect(
        one('SELECT tenant_id, issued_at FROM certificates WHERE id = ?', SEED_IDS.certificates.sraDstEdge),
      ).toEqual({ tenant_id: SRA, issued_at: '2026-04-04T14:30:00.000Z' });
    });
    it('SRA certificate 115 falls on 4 Apr 2026 in Perth', () => {
      expect(localDate('Australia/Perth', '2026-04-04T14:30:00.000Z')).toBe('4 Apr 2026');
    });
  });

  describe('two Emma Wilsons', () => {
    it('exist exactly twice: one in HHT (1001) and one in SRA (2001)', () => {
      expect(rows("SELECT id, tenant_id FROM learners WHERE name = 'Emma Wilson' ORDER BY id")).toEqual([
        { id: 1001, tenant_id: HHT },
        { id: 2001, tenant_id: SRA },
      ]);
    });
    it('each holds at least one certificate in her own tenant', () => {
      const certs = rows<{ learner_id: number; tenant_id: number }>(
        'SELECT learner_id, tenant_id FROM certificates WHERE learner_id IN (1001, 2001) ORDER BY learner_id',
      );
      expect(certs.filter((c) => c.learner_id === 1001).map((c) => c.tenant_id)).toEqual([HHT, HHT, HHT]);
      expect(certs.filter((c) => c.learner_id === 2001).map((c) => c.tenant_id)).toEqual([SRA, SRA]);
    });
  });

  describe('audit log', () => {
    it('has 8145 rows: one ISSUE per certificate plus one REVOKE per revocation', () => {
      expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'ISSUE'").n).toBe(8060);
      expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'REVOKE'").n).toBe(85);
    });
    it('gives every certificate exactly one ISSUE row', () => {
      expect(
        one<{ n: number }>(
          `SELECT COUNT(*) AS n FROM certificates c
            WHERE (SELECT COUNT(*) FROM audit_logs a WHERE a.certificate_id = c.id AND a.action = 'ISSUE') <> 1`,
        ).n,
      ).toBe(0);
    });
    it('gives exactly the revoked certificates one REVOKE row', () => {
      expect(
        one<{ n: number }>(
          `SELECT COUNT(*) AS n FROM certificates c
            WHERE (SELECT COUNT(*) FROM audit_logs a WHERE a.certificate_id = c.id AND a.action = 'REVOKE')
                  <> CASE c.status WHEN 'revoked' THEN 1 ELSE 0 END`,
        ).n,
      ).toBe(0);
    });
    it('agrees with its certificate on actor, time, tenant, course, learner and has no run', () => {
      expect(
        one<{ n: number }>(
          `SELECT COUNT(*) AS n FROM audit_logs a JOIN certificates c ON c.id = a.certificate_id
            WHERE NOT (a.tenant_id = c.tenant_id AND a.course_id = c.course_id
                       AND a.learner_id = c.learner_id AND a.run_id IS NULL
                       AND ((a.action = 'ISSUE' AND a.actor_id = c.issued_by AND a.created_at = c.issued_at)
                         OR (a.action = 'REVOKE' AND a.actor_id = c.revoked_by AND a.created_at = c.revoked_at)))`,
        ).n,
      ).toBe(0);
    });
    it('has no orphan audit rows', () => {
      expect(
        one<{ n: number }>(
          'SELECT COUNT(*) AS n FROM audit_logs a LEFT JOIN certificates c ON c.id = a.certificate_id WHERE c.id IS NULL',
        ).n,
      ).toBe(0);
    });
  });

  describe('serial numbers', () => {
    it('follow {TENANT_CODE}-{YYYY}-{6 digits}', () => {
      expect(
        one<{ n: number }>(
          `SELECT COUNT(*) AS n FROM certificates c JOIN tenants t ON t.id = c.tenant_id
            WHERE c.serial NOT GLOB t.code || '-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'`,
        ).n,
      ).toBe(0);
    });
    it('are unique across all tenants', () => {
      expect(one<{ d: number; n: number }>('SELECT COUNT(DISTINCT serial) AS d, COUNT(*) AS n FROM certificates')).toEqual({
        d: 8060,
        n: 8060,
      });
    });
    it('count up per tenant from 000001 in issued_at order (ties by id)', () => {
      const ordered = rows<{ tenant_id: number; serial: string }>(
        'SELECT tenant_id, serial FROM certificates ORDER BY tenant_id, issued_at, id',
      );
      let tenant = -1;
      let position = 0;
      let violations = 0;
      for (const r of ordered) {
        if (r.tenant_id !== tenant) {
          tenant = r.tenant_id;
          position = 0;
        }
        position += 1;
        if (Number(r.serial.split('-')[2]) !== position) violations += 1;
      }
      expect(violations).toBe(0);
    });
    it('use the tenant-local year, not the UTC year', () => {
      const tz = new Map(rows<{ id: number; timezone: string }>('SELECT id, timezone FROM tenants').map((t) => [t.id, t.timezone]));
      const certs = rows<{ tenant_id: number; serial: string; issued_at: string }>(
        'SELECT tenant_id, serial, issued_at FROM certificates',
      );
      const wrong = certs.filter(
        (c) => Number(c.serial.split('-')[1]) !== tenantLocalYear(c.issued_at, tz.get(c.tenant_id) as string),
      );
      expect(wrong).toHaveLength(0);
    });
    it('include 6 LCL certificates whose local year differs from the UTC year', () => {
      expect(
        one<{ n: number }>(
          "SELECT COUNT(*) AS n FROM certificates WHERE tenant_id = 3 AND substr(serial, 5, 4) <> substr(issued_at, 1, 4)",
        ).n,
      ).toBe(6);
    });
    it('pin well-known serials', () => {
      expect(
        rows('SELECT id, serial FROM certificates WHERE id IN (45, 115, 1001) ORDER BY id'),
      ).toEqual([
        { id: 45, serial: 'HHT-2026-000037' },
        { id: 115, serial: 'SRA-2026-000013' },
        { id: 1001, serial: 'LCL-2025-002043' },
      ]);
    });
    it('leave tenants.next_serial at certificate count + 1', () => {
      expect(rows('SELECT code, next_serial FROM tenants ORDER BY id')).toEqual([
        { code: 'HHT', next_serial: 46 },
        { code: 'SRA', next_serial: 16 },
        { code: 'LCL', next_serial: 8001 },
        { code: 'NHI', next_serial: 1 },
      ]);
    });
  });

  describe('enrollment, admin and tenant consistency', () => {
    it('gives every certificate a completed enrollment with completed_at <= issued_at', () => {
      expect(
        one<{ n: number }>(
          `SELECT COUNT(*) AS n FROM certificates c
             LEFT JOIN enrollments e
               ON e.tenant_id = c.tenant_id AND e.course_id = c.course_id AND e.learner_id = c.learner_id
            WHERE e.status IS NOT 'completed' OR e.completed_at > c.issued_at`,
        ).n,
      ).toBe(0);
    });
    it('only lets admins who manage a tenant issue or revoke in it', () => {
      expect(
        one<{ n: number }>(
          `SELECT COUNT(*) AS n FROM certificates c
            WHERE NOT EXISTS (SELECT 1 FROM admin_tenants x WHERE x.admin_id = c.issued_by AND x.tenant_id = c.tenant_id)
               OR (c.revoked_by IS NOT NULL AND NOT EXISTS
                    (SELECT 1 FROM admin_tenants x WHERE x.admin_id = c.revoked_by AND x.tenant_id = c.tenant_id))`,
        ).n,
      ).toBe(0);
    });
    it('revokes strictly after issuing', () => {
      expect(
        one<{ n: number }>("SELECT COUNT(*) AS n FROM certificates WHERE status = 'revoked' AND revoked_at <= issued_at").n,
      ).toBe(0);
    });
    it('keeps each certificate course and learner inside the certificate tenant', () => {
      expect(
        one<{ n: number }>(
          `SELECT COUNT(*) AS n FROM certificates c
             JOIN courses co ON co.id = c.course_id JOIN learners l ON l.id = c.learner_id
            WHERE co.tenant_id <> c.tenant_id OR l.tenant_id <> c.tenant_id`,
        ).n,
      ).toBe(0);
    });
  });

  describe('additional invariants', () => {
    it('revokes 3 HHT, 2 SRA and 80 LCL certificates (1% of LCL)', () => {
      const byTenant = rows("SELECT tenant_id, COUNT(*) AS n FROM certificates WHERE status = 'revoked' GROUP BY tenant_id ORDER BY tenant_id");
      expect(byTenant).toEqual([
        { tenant_id: HHT, n: 3 },
        { tenant_id: SRA, n: 2 },
        { tenant_id: LCL, n: 80 },
      ]);
    });
    it('revokes the documented HHT and SRA certificate ids', () => {
      const ids = rows<{ id: number }>("SELECT id FROM certificates WHERE tenant_id IN (1, 2) AND status = 'revoked' ORDER BY id").map((r) => r.id);
      expect(ids).toEqual([3, 11, 34, 103, 110]);
    });
    it('seeds no bulk-issue runs or run items', () => {
      expect(
        one<{ n: number }>('SELECT (SELECT COUNT(*) FROM bulk_issue_runs) + (SELECT COUNT(*) FROM bulk_issue_run_items) AS n').n,
      ).toBe(0);
    });
    it('keeps learner emails unique within a tenant', () => {
      expect(
        one<{ n: number }>(
          'SELECT COUNT(*) AS n FROM (SELECT 1 FROM learners GROUP BY tenant_id, email HAVING COUNT(*) > 1)',
        ).n,
      ).toBe(0);
    });
    it('stores every timestamp as UTC ISO with milliseconds and Z', () => {
      const columns: Array<[string, string]> = [
        ['certificates', 'issued_at'],
        ['certificates', 'revoked_at'],
        ['enrollments', 'completed_at'],
        ['audit_logs', 'created_at'],
      ];
      let bad = 0;
      for (const [table, column] of columns) {
        for (const { v } of rows<{ v: string | null }>(`SELECT ${column} AS v FROM ${table}`)) {
          if (v !== null && !ISO_MS_RE.test(v)) bad += 1;
        }
      }
      expect(bad).toBe(0);
    });
    it('passes PRAGMA foreign_key_check', () => {
      expect(rows('PRAGMA foreign_key_check')).toEqual([]);
    });
  });

  it('seeds in under 3000 ms', () => {
    expect(seedMs).toBeLessThan(3000);
  });
});

describe('seed determinism', () => {
  const tables = [
    'tenants',
    'admins',
    'admin_tenants',
    'courses',
    'learners',
    'enrollments',
    'certificates',
    'bulk_issue_runs',
    'bulk_issue_run_items',
    'audit_logs',
  ];
  const dump = (db: DatabaseSync): Record<string, unknown[]> =>
    Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));

  it('produces identical rows in every table when seeded twice', () => {
    const a = freshSeededDb().db;
    const b = freshSeededDb().db;
    expect(dump(a)).toEqual(dump(b));
  });
});
