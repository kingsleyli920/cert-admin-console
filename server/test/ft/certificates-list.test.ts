import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  certificateListResponseSchema,
  errorResponseSchema,
  type CertificateListItem,
  type CertificateListResponse,
} from '@cac/shared';
import { SEED_IDS } from '../../src/db/seed';
import { buildTestApp, signIn } from '../helpers/app';

const { hht: HHT, sra: SRA, lcl: LCL, nhi: NHI } = SEED_IDS.tenants;

let app: FastifyInstance;
let alice: string;
let bob: string;
beforeAll(async () => {
  app = await buildTestApp();
  alice = await signIn(app, 'alice');
  bob = await signIn(app, 'bob');
});
afterAll(() => app.close());

async function list(cookie: string, tenantId: number | string, query = ''): Promise<CertificateListResponse> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/tenants/${tenantId}/certificates${query ? `?${query}` : ''}`,
    headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return certificateListResponseSchema.parse(res.json());
}

const ids = (r: CertificateListResponse) => r.items.map((i) => i.id);

describe('GET /api/tenants/:tid/certificates: paging', () => {
  it('returns page 1 of alice\'s HHT list newest first (issuedAt desc, id desc)', async () => {
    const r = await list(alice, HHT);
    expect(r).toMatchObject({ total: 45, page: 1, pageSize: 20 });
    expect(r.items).toHaveLength(20);
    for (let i = 1; i < r.items.length; i++) {
      const [a, b] = [r.items[i - 1], r.items[i]];
      expect(a.issuedAt > b.issuedAt || (a.issuedAt === b.issuedAt && a.id > b.id)).toBe(true);
    }
    // Newest HHT certificates in the seed: 44 (2026-07-08), 43 (2026-06-25), 42 (2026-06-12).
    expect(ids(r).slice(0, 3)).toEqual([44, 43, 42]);
  });

  it('page 2 continues where page 1 ended; page 3 has the last 5; page 4 is empty', async () => {
    const [p1, p2, p3, p4] = await Promise.all([1, 2, 3, 4].map((p) => list(alice, HHT, `page=${p}`)));
    expect(p2.items).toHaveLength(20);
    expect(p3.items).toHaveLength(5);
    expect(p4).toMatchObject({ items: [], total: 45, page: 4, pageSize: 20 });
    const all = [...ids(p1), ...ids(p2), ...ids(p3)];
    expect(new Set(all).size).toBe(45);
  });

  it('honours pageSize', async () => {
    const r = await list(alice, HHT, 'pageSize=7&page=7');
    expect(r).toMatchObject({ total: 45, page: 7, pageSize: 7 });
    expect(r.items).toHaveLength(3);
  });

  it('returns the DST-edge certificate with its raw UTC timestamp', async () => {
    const r = await list(alice, HHT, 'pageSize=100');
    expect(r.items.find((i) => i.id === 45)).toEqual({
      id: 45,
      serial: 'HHT-2026-000037',
      learnerId: expect.any(Number),
      learnerName: expect.any(String),
      courseId: expect.any(Number),
      courseTitle: expect.any(String),
      issuedAt: '2026-04-04T14:30:00.000Z',
      status: 'valid',
    });
  });

  it('maps the first Fire Safety certificate to the contract shape', async () => {
    const r = await list(alice, HHT, 'courseId=101&sort=issuedAt&order=asc');
    expect(r.items[0]).toEqual({
      id: 1,
      serial: expect.stringMatching(/^HHT-2026-\d{6}$/),
      learnerId: 1001,
      learnerName: 'Emma Wilson',
      courseId: 101,
      courseTitle: 'Fire Safety 2026',
      issuedAt: '2026-02-18T09:30:00.000Z',
      status: 'valid',
    });
  });
});

describe('GET /api/tenants/:tid/certificates: search', () => {
  it('finds only the Emma Wilson of the tenant being queried', async () => {
    const hht = await list(alice, HHT, 'q=Emma%20Wilson&pageSize=100');
    expect(hht.items.length).toBeGreaterThan(0);
    expect(new Set(hht.items.map((i) => i.learnerId))).toEqual(new Set([SEED_IDS.learners.emmaWilsonHht]));

    const sra = await list(alice, SRA, 'q=Emma%20Wilson&pageSize=100');
    expect(sra.items.length).toBeGreaterThan(0);
    expect(new Set(sra.items.map((i) => i.learnerId))).toEqual(new Set([SEED_IDS.learners.emmaWilsonSra]));
  });

  it('is case-insensitive on names', async () => {
    const lower = await list(alice, HHT, 'q=emma%20wilson');
    const upper = await list(alice, HHT, 'q=EMMA%20WILSON');
    expect(ids(lower)).toEqual(ids(upper));
    expect(lower.total).toBeGreaterThan(0);
  });

  it('finds exactly one certificate by its serial', async () => {
    const r = await list(alice, HHT, 'q=HHT-2026-000037');
    expect(r.total).toBe(1);
    expect(ids(r)).toEqual([45]);
  });

  it('treats % and _ literally', async () => {
    expect((await list(alice, HHT, 'q=%25')).total).toBe(0);
    expect((await list(alice, HHT, 'q=_')).total).toBe(0);
  });

  it('counts the filtered total, not the tenant total', async () => {
    const r = await list(alice, HHT, 'q=Emma%20Wilson&pageSize=1');
    expect(r.items).toHaveLength(1);
    expect(r.total).toBeGreaterThan(1);
    expect(r.total).toBeLessThan(45);
  });
});

describe('GET /api/tenants/:tid/certificates: filters', () => {
  it('status=revoked returns exactly the seeded revoked certificates', async () => {
    const r = await list(alice, HHT, 'status=revoked');
    expect(r.total).toBe(3);
    expect(ids(r).sort((a, b) => a - b)).toEqual([...SEED_IDS.certificates.hhtRevoked]);
    expect(r.items.every((i) => i.status === 'revoked')).toBe(true);
  });

  it('courseId=101 returns exactly the 3 Fire Safety certificates', async () => {
    const r = await list(alice, HHT, 'courseId=101');
    expect(r.total).toBe(3);
    expect(ids(r).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(r.items.every((i) => i.courseTitle === 'Fire Safety 2026')).toBe(true);
  });

  it('a course of another tenant yields nothing', async () => {
    const r = await list(alice, HHT, `courseId=${SEED_IDS.courses.sraFoodSafetyBasics}`);
    expect(r).toMatchObject({ items: [], total: 0 });
  });

  it('combines course and status', async () => {
    expect(ids(await list(alice, HHT, 'courseId=101&status=revoked'))).toEqual([3]);
    expect((await list(alice, HHT, 'courseId=101&status=valid')).total).toBe(2);
  });
});

describe('GET /api/tenants/:tid/certificates: sorting', () => {
  const key: Record<string, (i: CertificateListItem) => string> = {
    issuedAt: (i) => i.issuedAt,
    learnerName: (i) => i.learnerName.toLowerCase(),
    courseTitle: (i) => i.courseTitle.toLowerCase(),
    serial: (i) => i.serial,
  };

  it.each(Object.keys(key).flatMap((sort) => [[sort, 'asc'], [sort, 'desc']] as const))(
    'sort=%s order=%s is ordered, ties broken by id in the same direction',
    async (sort, order) => {
      const r = await list(alice, HHT, `sort=${sort}&order=${order}&pageSize=100`);
      expect(r.items).toHaveLength(45);
      const dir = order === 'asc' ? 1 : -1;
      const k = key[sort];
      for (let i = 1; i < r.items.length; i++) {
        const [a, b] = [r.items[i - 1], r.items[i]];
        const cmp = k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0;
        const ordered = cmp * dir < 0 || (cmp === 0 && (a.id - b.id) * dir < 0);
        expect(ordered, `${a.id} before ${b.id}`).toBe(true);
      }
    },
  );

  it('sorting is stable across pages (no duplicates, no gaps)', async () => {
    const pages = await Promise.all(
      [1, 2, 3].map((p) => list(alice, HHT, `sort=learnerName&order=asc&pageSize=20&page=${p}`)),
    );
    const all = pages.flatMap(ids);
    expect(all).toHaveLength(45);
    expect(new Set(all).size).toBe(45);
  });
});

describe('GET /api/tenants/:tid/certificates: tenants', () => {
  it('NHI has courses but no certificates', async () => {
    expect(await list(alice, NHI)).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('SRA has 15 certificates, including the Perth DST-edge instant', async () => {
    const r = await list(alice, SRA, 'pageSize=100');
    expect(r.total).toBe(15);
    expect(r.items.find((i) => i.id === SEED_IDS.certificates.sraDstEdge)?.issuedAt).toBe('2026-04-04T14:30:00.000Z');
  });

  it('LCL as bob: 8000 certificates; the last page of 100 holds the remainder', async () => {
    const first = await list(bob, LCL);
    expect(first.total).toBe(8000);
    const last = await list(bob, LCL, 'pageSize=100&page=80');
    expect(last).toMatchObject({ total: 8000, page: 80, pageSize: 100 });
    expect(last.items).toHaveLength(100);
    expect((await list(bob, LCL, 'pageSize=100&page=81')).items).toEqual([]);
  });
});

describe('GET /api/tenants/:tid/certificates: validation', () => {
  it.each([
    'pageSize=101',
    'pageSize=0',
    'page=0',
    'page=-1',
    'page=1.5',
    'sort=bogus',
    'sort=c.id;DROP%20TABLE%20certificates',
    'order=up',
    'status=expired',
    'courseId=abc',
    'courseId=0',
    `q=${'x'.repeat(101)}`,
  ])('rejects %s with 400 VALIDATION_ERROR', async (query) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tenants/${HHT}/certificates?${query}`,
      headers: { cookie: alice },
    });
    expect(res.statusCode).toBe(400);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
