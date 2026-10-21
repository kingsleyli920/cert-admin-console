import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coursesResponseSchema, type CourseSummary } from '@cac/shared';
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

async function courses(cookie: string, tenantId: number): Promise<CourseSummary[]> {
  const res = await app.inject({ method: 'GET', url: `/api/tenants/${tenantId}/courses`, headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return coursesResponseSchema.parse(res.json()).items;
}

const counts = (eligible: number, alreadyIssued: number, notCompleted: number, inactive: number) => ({
  eligible,
  alreadyIssued,
  notCompleted,
  inactive,
});

describe('GET /api/tenants/:tid/courses', () => {
  it('HHT: 4 courses ordered by title, Fire Safety 2026 matches SPEC §4', async () => {
    const items = await courses(alice, HHT);
    expect(items.map((c) => c.title)).toEqual([
      'Fire Safety 2026',
      'Infection Control',
      'Manual Handling',
      'Privacy & Confidentiality',
    ]);
    expect(items[0]).toEqual({ id: 101, title: 'Fire Safety 2026', enrolled: 16, counts: counts(8, 3, 4, 1) });
  });

  it('HHT: courses with only certificates (and two not-completed learners) add up', async () => {
    const byId = new Map((await courses(alice, HHT)).map((c) => [c.id, c]));
    expect(byId.get(102)).toMatchObject({ enrolled: 16, counts: counts(0, 14, 2, 0) }); // incl. 1 revoked
    expect(byId.get(103)).toMatchObject({ enrolled: 14, counts: counts(0, 14, 0, 0) });
    expect(byId.get(104)).toMatchObject({ enrolled: 14, counts: counts(0, 14, 0, 0) }); // incl. 1 revoked
  });

  it('SRA: 3 courses ordered by title, only SRA courses', async () => {
    expect(await courses(alice, SRA)).toEqual([
      { id: 203, title: 'First Aid Refresher', enrolled: 5, counts: counts(0, 5, 0, 0) },
      { id: 201, title: 'Food Safety Basics', enrolled: 8, counts: counts(0, 5, 3, 0) },
      { id: 202, title: 'Working at Heights', enrolled: 5, counts: counts(0, 5, 0, 0) },
    ]);
  });

  it('NHI: no certificates, so alreadyIssued is 0 and completed learners are eligible', async () => {
    expect(await courses(alice, NHI)).toEqual([
      { id: 401, title: 'Mental Health First Aid', enrolled: 5, counts: counts(3, 0, 2, 0) },
      { id: 402, title: 'Workplace Ergonomics', enrolled: 5, counts: counts(3, 0, 2, 0) },
    ]);
  });

  it('LCL as bob: 20 courses, each with 400 enrolled and 400 already issued', async () => {
    const items = await courses(bob, LCL);
    expect(items).toHaveLength(20);
    for (const c of items) {
      expect(c.enrolled, c.title).toBe(400);
      expect(c.counts, c.title).toEqual(counts(0, 400, 0, 0));
    }
    expect(items.map((c) => c.title)).toEqual(items.map((c) => c.title).sort((a, b) => a.localeCompare(b)));
  });

  it('lists a course without enrollments with zero counts', async () => {
    app.db.exec("INSERT INTO courses (id, tenant_id, title) VALUES (9001, 4, 'Aardvark Handling')");
    try {
      const items = await courses(alice, NHI);
      expect(items[0]).toEqual({ id: 9001, title: 'Aardvark Handling', enrolled: 0, counts: counts(0, 0, 0, 0) });
    } finally {
      app.db.exec('DELETE FROM courses WHERE id = 9001');
    }
  });

  it('counts a completed learner who is inactive as inactive, not eligible', async () => {
    // Make NHI learner 4001 inactive: completed, no certificate, inactive -> inactive.
    app.db.exec("UPDATE learners SET status = 'inactive' WHERE id = 4001");
    try {
      const nhi = (await courses(alice, NHI)).find((c) => c.id === 401);
      expect(nhi?.counts).toEqual(counts(2, 0, 2, 1));
    } finally {
      app.db.exec("UPDATE learners SET status = 'active' WHERE id = 4001");
    }
  });
});
