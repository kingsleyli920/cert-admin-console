import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { certificateListResponseSchema, coursesResponseSchema } from '@cac/shared';
import { SEED_IDS } from '../../src/db/seed';
import { buildTestApp, signIn } from '../helpers/app';
import { describeAccessMatrix } from '../helpers/access-matrix';

const { hht: HHT, sra: SRA } = SEED_IDS.tenants;

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildTestApp();
});
afterAll(() => app.close());

/** Seed truth per tenant code (SPEC §4). */
const CERTIFICATE_TOTALS: Record<string, number> = { HHT: 45, SRA: 15, LCL: 8000, NHI: 0 };
const COURSE_COUNTS: Record<string, number> = { HHT: 4, SRA: 3, LCL: 20, NHI: 2 };

describeAccessMatrix('GET /api/tenants/:tid/certificates', () => app, {
  expectAllowed: (res, { tenant }) => {
    const body = certificateListResponseSchema.parse(res.json());
    expect(body.total).toBe(CERTIFICATE_TOTALS[tenant.code]);
    expect(body.items).toHaveLength(Math.min(body.total, 20));
    for (const item of body.items) {
      expect(item.serial.startsWith(`${tenant.code}-`), `${item.serial} in ${tenant.code}`).toBe(true);
    }
  },
});

describeAccessMatrix('GET /api/tenants/:tid/courses', () => app, {
  expectAllowed: (res, { tenant }) => {
    const { items } = coursesResponseSchema.parse(res.json());
    expect(items).toHaveLength(COURSE_COUNTS[tenant.code]);
  },
});

describe('resources of another tenant addressed through an allowed tenant id', () => {
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  it('filtering HHT by an SRA course id matches nothing', async () => {
    const alice = await signIn(app, 'alice');
    const res = await get(alice, `/api/tenants/${HHT}/certificates?courseId=${SEED_IDS.courses.sraFoodSafetyBasics}`);

    expect(res.statusCode).toBe(200);
    expect(certificateListResponseSchema.parse(res.json())).toMatchObject({ items: [], total: 0 });
  });

  it('the same search text finds different learners in HHT and SRA', async () => {
    const alice = await signIn(app, 'alice');
    const learnerIds = async (tid: number) => {
      const res = await get(alice, `/api/tenants/${tid}/certificates?q=Emma%20Wilson&pageSize=100`);
      return new Set(certificateListResponseSchema.parse(res.json()).items.map((i) => i.learnerId));
    };

    expect(await learnerIds(HHT)).toEqual(new Set([1001]));
    expect(await learnerIds(SRA)).toEqual(new Set([2001]));
  });
});

describe('two admins of the same tenant', () => {
  it('carol sees exactly the HHT page alice sees for the same query', async () => {
    const [alice, carol] = [await signIn(app, 'alice'), await signIn(app, 'carol')];
    const url = `/api/tenants/${HHT}/certificates?sort=learnerName&order=asc&page=2&pageSize=10`;

    const [forAlice, forCarol] = await Promise.all(
      [alice, carol].map(async (cookie) => {
        const res = await app.inject({ method: 'GET', url, headers: { cookie } });
        expect(res.statusCode).toBe(200);
        return certificateListResponseSchema.parse(res.json());
      }),
    );

    expect(forAlice.items).toHaveLength(10);
    expect(forCarol).toEqual(forAlice);
  });
});
