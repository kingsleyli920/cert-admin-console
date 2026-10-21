// GET /api/tenants/:tid/certificates/export.csv (SPEC §1.4 CSV, §2.6 #3/#4, §3.3 Export, §3.4 Timezones, T6).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bulkIssueRunResponseSchema, certificateListResponseSchema, CSV_BOM } from '@cac/shared';
import { SEED_IDS } from '../../src/db/seed';
import { buildTestApp, signIn } from '../helpers/app';
import { describeAccessMatrix } from '../helpers/access-matrix';
import { parseCsv } from '../helpers/csv';

const { hht: HHT, sra: SRA, lcl: LCL, nhi: NHI } = SEED_IDS.tenants;
const NOW = '2025-12-31T14:30:00.000Z'; // Sydney 2026-01-01 01:30 AEDT, Perth 2025-12-31 22:30 AWST
const header = (timezone: string) => ['Learner Name', 'Course Title', 'Serial Number', `Issue Date (${timezone})`, 'Status'];
/** An admin who manages each tenant. */
const ADMIN_OF: Record<number, string> = { [HHT]: 'alice', [SRA]: 'alice', [NHI]: 'alice', [LCL]: 'bob' };
/** A course of each tenant (HHT: Fire Safety 2026). */
const COURSE_OF: Record<number, number> = { [HHT]: 101, [SRA]: 201, [NHI]: 401, [LCL]: 301 };
const exportUrl = (tid: number | string, query = '') =>
  `/api/tenants/${tid}/certificates/export.csv${query ? `?${query}` : ''}`;

let app: FastifyInstance;
const cookies: Record<string, string> = {};
beforeAll(async () => {
  app = await buildTestApp({ now: () => new Date(NOW) });
  for (const admin of ['alice', 'bob', 'carol']) cookies[admin] = await signIn(app, admin);
});
afterAll(() => app.close());

async function exportCsv(tid: number, query = '', target: FastifyInstance = app) {
  const res = await target.inject({ method: 'GET', url: exportUrl(tid, query), headers: { cookie: cookies[ADMIN_OF[tid]] } });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  expect(res.body[0]).toBe(CSV_BOM);
  const [head, ...rows] = parseCsv(res.body.slice(1));
  return { res, head, rows };
}

async function listAll(tid: number, query: string) {
  const serials: string[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams(query);
    params.set('page', String(page));
    params.set('pageSize', '100');
    const res = await app.inject({
      method: 'GET',
      url: `/api/tenants/${tid}/certificates?${params}`,
      headers: { cookie: cookies[ADMIN_OF[tid]] },
    });
    expect(res.statusCode).toBe(200);
    const body = certificateListResponseSchema.parse(res.json());
    serials.push(...body.items.map((i) => i.serial));
    if (serials.length >= body.total) return { total: body.total, serials };
  }
}

describeAccessMatrix('GET /api/tenants/:tid/certificates/export.csv', () => app, {
  expectAllowed: (res, { tenant }) => {
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body[0]).toBe(CSV_BOM);
    const [head, ...rows] = parseCsv(res.body.slice(1));
    expect(head).toEqual(header(tenant.timezone));
    expect(rows.length > 0).toBe(tenant.code !== 'NHI');
    for (const row of rows) expect(row[2].startsWith(`${tenant.code}-`)).toBe(true);
  },
});

describe('export equals list (T6)', () => {
  const FILTERS: Array<[string, (tid: number) => string]> = [
    ['no filters', () => ''],
    ['q=Emma Wilson', () => 'q=Emma Wilson'],
    ['status=revoked', () => 'status=revoked'],
    ['courseId of the tenant', (tid) => `courseId=${COURSE_OF[tid]}`],
    ['sort=learnerName&order=asc', () => 'sort=learnerName&order=asc'],
    ['sort=serial&order=desc&status=valid', () => 'sort=serial&order=desc&status=valid'],
    ['q=% (literal percent)', () => 'q=%25'],
  ];
  for (const [tid, code] of [[HHT, 'HHT'], [SRA, 'SRA'], [LCL, 'LCL'], [NHI, 'NHI']] as const) {
    for (const [label, query] of FILTERS) {
      it(`${code}: ${label} has the list's total and order`, async () => {
        const q = query(tid);
        const list = await listAll(tid, q);
        const { rows } = await exportCsv(tid, q);
        expect(rows).toHaveLength(list.total);
        expect(rows.map((r) => r[2])).toEqual(list.serials);
      });
    }
  }

  it('the comparison is not vacuous: filters really narrow HHT', async () => {
    const all = (await exportCsv(HHT)).rows.length;
    const emma = (await exportCsv(HHT, 'q=Emma Wilson')).rows;
    const revoked = (await exportCsv(HHT, 'status=revoked')).rows.length;
    expect(all).toBe(45);
    expect(emma.length).toBeGreaterThan(0);
    expect(emma.every((r) => r[0] === 'Emma Wilson')).toBe(true);
    expect(revoked).toBe(3);
    expect((await exportCsv(HHT, 'q=%25')).rows).toHaveLength(0);
  });

  describe('Status column', () => {
    it('is the fifth column and is either Valid or Revoked', async () => {
      const { head, rows } = await exportCsv(HHT);
      expect(head[4]).toBe('Status');
      for (const row of rows) {
        expect(row).toHaveLength(5);
        expect(['Valid', 'Revoked']).toContain(row[4]);
      }
    });

    it('status=revoked exports only Revoked rows, status=valid only Valid rows', async () => {
      const revoked = (await exportCsv(HHT, 'status=revoked')).rows;
      expect(revoked).toHaveLength(3);
      expect(revoked.every((r) => r[4] === 'Revoked')).toBe(true);
      const valid = (await exportCsv(HHT, 'status=valid')).rows;
      expect(valid).toHaveLength(42);
      expect(valid.every((r) => r[4] === 'Valid')).toBe(true);
    });

    it('the unfiltered HHT export has 3 Revoked and 42 Valid rows', async () => {
      const { rows } = await exportCsv(HHT);
      expect(rows.filter((r) => r[4] === 'Revoked')).toHaveLength(3);
      expect(rows.filter((r) => r[4] === 'Valid')).toHaveLength(42);
    });
  });

  it('ignores page and pageSize', async () => {
    const { rows } = await exportCsv(HHT, 'page=2&pageSize=5');
    expect(rows).toHaveLength(45);
  });

  it('exports every LCL certificate', async () => {
    expect((await exportCsv(LCL)).rows).toHaveLength(8000);
  });

  it("a course of another tenant yields a header-only file, never that tenant's rows", async () => {
    const { head, rows } = await exportCsv(HHT, `courseId=${COURSE_OF[SRA]}`);
    expect(head).toEqual(header('Australia/Sydney'));
    expect(rows).toEqual([]);
  });

  it('an invalid filter is 400, like the list', async () => {
    const res = await app.inject({ method: 'GET', url: exportUrl(HHT, 'status=bogus'), headers: { cookie: cookies.alice } });
    expect(res.statusCode).toBe(400);
  });

  it('is not shadowed by /certificates/:id', async () => {
    const res = await app.inject({ method: 'GET', url: exportUrl(HHT), headers: { cookie: cookies.alice } });
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
  });
});

describe('timezones', () => {
  it('header names the tenant timezone', async () => {
    expect((await exportCsv(HHT)).head[3]).toBe('Issue Date (Australia/Sydney)');
    expect((await exportCsv(SRA)).head[3]).toBe('Issue Date (Australia/Perth)');
    const nhi = await exportCsv(NHI);
    expect(nhi.head).toEqual(header('Australia/Brisbane'));
    expect(nhi.rows).toEqual([]);
  });

  it('the same UTC instant (2026-04-04T14:30Z) is 2026-04-05 in HHT and 2026-04-04 in SRA', async () => {
    const hht = (await exportCsv(HHT)).rows.find((r) => r[2] === serialOf(HHT, SEED_IDS.certificates.hhtDstEdge));
    const sra = (await exportCsv(SRA)).rows.find((r) => r[2] === serialOf(SRA, SEED_IDS.certificates.sraDstEdge));
    expect(hht?.[3]).toBe('2026-04-05');
    expect(sra?.[3]).toBe('2026-04-04');
  });
});

function serialOf(tid: number, certificateId: number): string {
  const row = app.db.prepare('SELECT serial FROM certificates WHERE id = ? AND tenant_id = ?').get(certificateId, tid) as
    | { serial: string }
    | undefined;
  if (!row) throw new Error(`no certificate ${certificateId} in tenant ${tid}`);
  return row.serial;
}

describe('file name', () => {
  it('uses the tenant code and the tenant-local date of "now"', async () => {
    const hht = await exportCsv(HHT);
    const sra = await exportCsv(SRA);
    expect(hht.res.headers['content-disposition']).toBe('attachment; filename="certificates-HHT-2026-01-01.csv"');
    expect(sra.res.headers['content-disposition']).toBe('attachment; filename="certificates-SRA-2025-12-31.csv"');
  });
});

describe('mutating exports', () => {
  let mut: FastifyInstance;
  beforeEach(async () => {
    mut = await buildTestApp({ now: () => new Date(NOW) });
  });
  afterEach(() => mut.close());

  function insertCertificate(id: number, learnerName: string) {
    mut.db
      .prepare("INSERT INTO learners (id, tenant_id, name, email, status) VALUES (?, 1, ?, 'x@example.com', 'active')")
      .run(id, learnerName);
    mut.db
      .prepare(
        `INSERT INTO certificates (id, tenant_id, course_id, learner_id, serial, issued_at, issued_by, status)
         VALUES (?, 1, 101, ?, ?, '2026-06-01T00:00:00.000Z', 'alice', 'valid')`,
      )
      .run(id, id, `HHT-2026-${id}`);
  }

  it('guards formulas and quotes per RFC 4180; parsing round-trips to the guarded values', async () => {
    insertCertificate(90001, '=HYPERLINK("http://x","y")');
    insertCertificate(90002, 'Smith, "Jo"');
    insertCertificate(90003, '+1 555 / @home / -dash');
    const { res, rows } = await exportCsv(HHT, 'q=HHT-2026-9000', mut);

    expect(res.body).toContain(`"'=HYPERLINK(""http://x"",""y"")",Fire Safety 2026,HHT-2026-90001,2026-06-01,Valid\r\n`);
    expect(res.body).toContain(`"Smith, ""Jo""",Fire Safety 2026,HHT-2026-90002,2026-06-01,Valid\r\n`);
    expect(rows.map((r) => r[0]).sort()).toEqual(
      [`'=HYPERLINK("http://x","y")`, 'Smith, "Jo"', "'+1 555 / @home / -dash"].sort(),
    );
  });

  it('reflects a bulk issue run (+8) and a revoke (certificate stays in the file)', async () => {
    const cookie = await signIn(mut, 'alice');
    expect((await exportCsv(HHT, '', mut)).rows).toHaveLength(45);

    const post = await mut.inject({
      method: 'POST',
      url: `/api/tenants/${HHT}/courses/101/bulk-issue`,
      headers: { cookie, 'idempotency-key': randomUUID() },
    });
    expect(post.statusCode).toBe(202);
    const runId = bulkIssueRunResponseSchema.parse(post.json()).run.id;
    for (let i = 0; ; i++) {
      const res = await mut.inject({ method: 'GET', url: `/api/tenants/${HHT}/bulk-issue-runs/${runId}`, headers: { cookie } });
      if (bulkIssueRunResponseSchema.parse(res.json()).run.status === 'completed') break;
      if (i > 400) throw new Error('run did not complete');
      await new Promise((r) => setTimeout(r, 5));
    }
    const revoked = await mut.inject({
      method: 'POST',
      url: `/api/tenants/${HHT}/certificates/2/revoke`,
      headers: { cookie },
      payload: { reason: 'Issued in error' },
    });
    expect(revoked.statusCode).toBe(200);

    const serial = (mut.db.prepare('SELECT serial FROM certificates WHERE id = 2').get() as { serial: string }).serial;
    const after = await exportCsv(HHT, '', mut);
    expect(after.rows).toHaveLength(53);
    expect(after.rows.find((r) => r[2] === serial)?.[4]).toBe('Revoked');
    expect((await exportCsv(HHT, 'status=revoked', mut)).rows).toHaveLength(4);
  });
});
