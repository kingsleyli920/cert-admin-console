// GET /api/tenants/:tid/certificates/:id (SPEC §1.4 Detail, §2.4, §3.4).
// The generic access-matrix helper cannot be used: certificate ids differ per tenant, so each
// (admin, tenant, certificate) pair is spelled out.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { certificateDetailSchema, errorResponseSchema, type CertificateDetail } from '@cac/shared';
import { SEED_IDS } from '../../src/db/seed';
import { buildTestApp, signIn } from '../helpers/app';

const { hht: HHT, sra: SRA, lcl: LCL, nhi: NHI } = SEED_IDS.tenants;
const HHT_CERT = SEED_IDS.certificates.hhtDstEdge; // 45
const SRA_CERT = SEED_IDS.certificates.sraDstEdge; // 115
const LCL_CERT = SEED_IDS.certificates.lclFirst; // 1001
const REVOKED_CERT = SEED_IDS.certificates.fireSafetyRevoked; // 3

let app: FastifyInstance;
const cookies: Record<string, string> = {};
beforeAll(async () => {
  app = await buildTestApp();
  for (const admin of ['alice', 'carol', 'bob']) cookies[admin] = await signIn(app, admin);
});
afterAll(() => app.close());

const get = (tid: string | number, id: string | number, cookie?: string) =>
  app.inject({
    method: 'GET',
    url: `/api/tenants/${tid}/certificates/${id}`,
    headers: cookie ? { cookie } : {},
  });

async function detail(tid: number, id: number, admin = 'alice'): Promise<CertificateDetail> {
  const res = await get(tid, id, cookies[admin]);
  expect(res.statusCode, res.body).toBe(200);
  return certificateDetailSchema.parse(res.json());
}

function expectNotFound(res: { statusCode: number; json: () => unknown }): void {
  expect(res.statusCode).toBe(404);
  expect(errorResponseSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
}

describe('GET certificate detail: content', () => {
  it('returns the HHT DST-edge certificate with its issuer and a single ISSUE audit entry', async () => {
    const d = await detail(HHT, HHT_CERT);
    expect(d).toMatchObject({
      id: 45,
      serial: 'HHT-2026-000037',
      issuedAt: '2026-04-04T14:30:00.000Z',
      status: 'valid',
      issuedBy: { id: 'alice', name: 'Alice Nguyen' },
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    });
    expect(d.learnerName).toEqual(expect.any(String));
    expect(d.courseTitle).toEqual(expect.any(String));
    expect(d.audit).toHaveLength(1);
    expect(d.audit[0]).toMatchObject({
      action: 'ISSUE',
      actor: { id: 'alice', name: 'Alice Nguyen' },
      createdAt: '2026-04-04T14:30:00.000Z',
      certificateId: 45,
      courseId: d.courseId,
      learnerId: d.learnerId,
      runId: null,
    });
  });

  it('returns a seeded revoked certificate with revoke info and ISSUE then REVOKE audit', async () => {
    const d = await detail(HHT, REVOKED_CERT);
    expect(d).toMatchObject({
      id: 3,
      status: 'revoked',
      courseId: 101,
      courseTitle: 'Fire Safety 2026',
      issuedBy: { id: 'alice', name: 'Alice Nguyen' },
      revokedAt: '2026-03-05T14:00:00.000Z',
      revokedBy: { id: 'alice', name: 'Alice Nguyen' },
      revokeReason: 'Issued against superseded course version',
    });
    expect(d.audit.map((a) => [a.action, a.actor.id, a.createdAt])).toEqual([
      ['ISSUE', 'alice', d.issuedAt],
      ['REVOKE', 'alice', '2026-03-05T14:00:00.000Z'],
    ]);
  });

  it('only lists audit rows of this certificate', async () => {
    const a = await detail(HHT, 1);
    const b = await detail(HHT, 2);
    expect(a.audit.every((e) => e.certificateId === 1)).toBe(true);
    expect(b.audit.every((e) => e.certificateId === 2)).toBe(true);
  });

  it('shows identical data to alice and carol (same tenant, several admins)', async () => {
    expect(await detail(HHT, HHT_CERT, 'carol')).toEqual(await detail(HHT, HHT_CERT, 'alice'));
  });
});

describe('GET certificate detail: tenant scoping', () => {
  it('a certificate of another tenant addressed through an allowed tenant is 404', async () => {
    expectNotFound(await get(HHT, SRA_CERT, cookies.alice));
    expectNotFound(await get(SRA, HHT_CERT, cookies.alice));
    expectNotFound(await get(HHT, LCL_CERT, cookies.alice));
  });

  it.each(['0', 'abc', '01', '-5', '999999', '1.5', '1e3', '9007199254740993'])(
    'malformed or unknown certificate id %s -> 404',
    async (id) => {
      expectNotFound(await get(HHT, id, cookies.alice));
    },
  );
});

describe('GET certificate detail: admin x tenant matrix', () => {
  const cases: Array<[admin: string, tid: number, id: number, expected: 200 | 404]> = [
    ['alice', HHT, HHT_CERT, 200],
    ['alice', SRA, SRA_CERT, 200],
    ['alice', NHI, 9999, 404], // NHI has no certificates
    ['alice', LCL, LCL_CERT, 404], // not alice's tenant
    ['carol', HHT, HHT_CERT, 200],
    ['carol', SRA, SRA_CERT, 404],
    ['carol', LCL, LCL_CERT, 404],
    ['carol', NHI, 9999, 404],
    ['bob', LCL, LCL_CERT, 200],
    ['bob', HHT, HHT_CERT, 404],
    ['bob', SRA, SRA_CERT, 404],
    ['bob', NHI, 9999, 404],
  ];
  it.each(cases)('%s, tenant %i, certificate %i -> %i', async (admin, tid, id, expected) => {
    const res = await get(tid, id, cookies[admin]);
    expect(res.statusCode).toBe(expected);
    if (expected === 200) {
      const d = certificateDetailSchema.parse(res.json());
      expect(d.id).toBe(id);
    } else {
      expectNotFound(res);
    }
  });

  it.each([
    [HHT, HHT_CERT],
    [SRA, SRA_CERT],
    [LCL, LCL_CERT],
    [NHI, 1],
    ['abc', 1],
  ])('no session, tenant %s certificate %i -> 401', async (tid, id) => {
    const res = await get(tid, id);
    expect(res.statusCode).toBe(401);
    expect(errorResponseSchema.parse(res.json()).error.code).toBe('UNAUTHORIZED');
  });
});
