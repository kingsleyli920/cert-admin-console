// POST /api/tenants/:tid/certificates/:id/revoke (SPEC §1.2, §2.4, §2.6 #1, §3.3 T7, §3.4).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bulkIssueRunResponseSchema,
  certificateDetailSchema,
  certificateListResponseSchema,
  errorResponseSchema,
  type CertificateDetail,
} from '@cac/shared';
import { SEED_IDS } from '../../src/db/seed';
import type { CertificateFaults } from '../../src/modules/certificates/routes';
import { buildTestApp, signIn } from '../helpers/app';

const { hht: HHT, lcl: LCL } = SEED_IDS.tenants;
const NOW = '2026-10-20T01:02:03.000Z';
const CERT = 1; // HHT Fire Safety, learner 1001, issued by alice, valid
const LCL_CERT = SEED_IDS.certificates.lclFirst;

let app: FastifyInstance;
let faults: CertificateFaults;
const cookies: Record<string, string> = {};
beforeEach(async () => {
  faults = {};
  app = await buildTestApp({ now: () => new Date(NOW), certificateFaults: faults });
  for (const admin of ['alice', 'carol', 'bob']) cookies[admin] = await signIn(app, admin);
});
afterEach(() => app.close());

const revoke = (tid: string | number, id: string | number, admin: string | null, payload?: unknown) =>
  app.inject({
    method: 'POST',
    url: `/api/tenants/${tid}/certificates/${id}/revoke`,
    headers: admin ? { cookie: cookies[admin] } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const detailOf = async (tid: number, id: number, admin = 'alice'): Promise<CertificateDetail> => {
  const res = await app.inject({
    method: 'GET',
    url: `/api/tenants/${tid}/certificates/${id}`,
    headers: { cookie: cookies[admin] },
  });
  expect(res.statusCode, res.body).toBe(200);
  return certificateDetailSchema.parse(res.json());
};
const revokeAudit = (id: number) =>
  (app.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE certificate_id = ? AND action = 'REVOKE'").get(id) as { n: number }).n;
const expectError = (res: { statusCode: number; json: () => unknown }, status: number, code: string) => {
  expect(res.statusCode).toBe(status);
  expect(errorResponseSchema.parse(res.json()).error.code).toBe(code);
};

describe('revoke: happy path', () => {
  it('carol revokes a certificate alice issued; detail shows both actors', async () => {
    const res = await revoke(HHT, CERT, 'carol', { reason: '  Issued in error  ' });
    expect(res.statusCode, res.body).toBe(200);
    const d = certificateDetailSchema.parse(res.json());
    expect(d).toMatchObject({
      id: CERT,
      status: 'revoked',
      issuedBy: { id: 'alice', name: 'Alice Nguyen' },
      revokedAt: NOW,
      revokedBy: { id: 'carol', name: 'Carol Smith' },
      revokeReason: 'Issued in error',
    });
    expect(d.audit.map((a) => [a.action, a.actor.id])).toEqual([
      ['ISSUE', 'alice'],
      ['REVOKE', 'carol'],
    ]);
    expect(d.audit[1]).toMatchObject({ createdAt: NOW, certificateId: CERT, runId: null, courseId: d.courseId, learnerId: d.learnerId });
    expect(await detailOf(HHT, CERT, 'alice')).toEqual(d);
  });

  it('the revoked certificate appears in the status=revoked list', async () => {
    await revoke(HHT, CERT, 'alice', { reason: 'x' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/tenants/${HHT}/certificates?status=revoked&pageSize=100`,
      headers: { cookie: cookies.alice },
    });
    const list = certificateListResponseSchema.parse(res.json());
    expect(list.items.map((i) => i.id)).toContain(CERT);
    expect(list.items.every((i) => i.status === 'revoked')).toBe(true);
  });

  it('a later bulk-issue run skips that learner with reason "revoked" referencing the certificate', async () => {
    await revoke(HHT, CERT, 'alice', { reason: 'x' });
    const post = await app.inject({
      method: 'POST',
      url: `/api/tenants/${HHT}/courses/101/bulk-issue`,
      headers: { cookie: cookies.alice, 'idempotency-key': randomUUID() },
    });
    expect(post.statusCode).toBe(202);
    const runId = bulkIssueRunResponseSchema.parse(post.json()).run.id;
    for (let i = 0; i < 400; i++) {
      const res = await app.inject({ method: 'GET', url: `/api/tenants/${HHT}/bulk-issue-runs/${runId}`, headers: { cookie: cookies.alice } });
      const { run } = bulkIssueRunResponseSchema.parse(res.json());
      if (run.status === 'completed') {
        const item = run.items.find((it) => it.learnerId === 1001);
        expect(item).toMatchObject({ outcome: 'skipped', reason: 'revoked', certificateId: CERT });
        return;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('run did not complete');
  });
});

describe('revoke: already revoked (T7)', () => {
  it('second revoke is 409 ALREADY_REVOKED and changes nothing', async () => {
    expect((await revoke(HHT, CERT, 'carol', { reason: 'first' })).statusCode).toBe(200);
    const before = await detailOf(HHT, CERT);
    expectError(await revoke(HHT, CERT, 'alice', { reason: 'second' }), 409, 'ALREADY_REVOKED');
    expect(await detailOf(HHT, CERT)).toEqual(before);
    expect(before).toMatchObject({ revokedBy: { id: 'carol' }, revokeReason: 'first' });
    expect(revokeAudit(CERT)).toBe(1);
  });

  it('revoking a seeded revoked certificate is 409 and adds no audit row', async () => {
    const id = SEED_IDS.certificates.fireSafetyRevoked;
    const before = await detailOf(HHT, id);
    expectError(await revoke(HHT, id, 'alice', { reason: 'again' }), 409, 'ALREADY_REVOKED');
    expect(await detailOf(HHT, id)).toEqual(before);
  });

  it('two concurrent revokes by alice and carol: exactly one 200, one 409, one REVOKE audit row', async () => {
    const [a, c] = await Promise.all([
      revoke(HHT, CERT, 'alice', { reason: 'alice reason' }),
      revoke(HHT, CERT, 'carol', { reason: 'carol reason' }),
    ]);
    expect([a.statusCode, c.statusCode].sort()).toEqual([200, 409]);
    const winner = a.statusCode === 200 ? 'alice' : 'carol';
    expect(revokeAudit(CERT)).toBe(1);
    const d = await detailOf(HHT, CERT);
    expect(d.revokedBy?.id).toBe(winner);
    expect(d.revokeReason).toBe(`${winner} reason`);
  });
});

describe('revoke: validation', () => {
  it.each([
    ['empty reason', { reason: '' }],
    ['blank reason', { reason: '   ' }],
    ['501 characters', { reason: 'x'.repeat(501) }],
    ['missing reason', {}],
    ['non-string reason', { reason: 5 }],
  ])('%s -> 400 VALIDATION_ERROR and nothing changes', async (_name, payload) => {
    expectError(await revoke(HHT, CERT, 'alice', payload), 400, 'VALIDATION_ERROR');
    expect((await detailOf(HHT, CERT)).status).toBe('valid');
    expect(revokeAudit(CERT)).toBe(0);
  });

  it('missing body -> 400 VALIDATION_ERROR', async () => {
    expectError(await revoke(HHT, CERT, 'alice'), 400, 'VALIDATION_ERROR');
    expect((await detailOf(HHT, CERT)).status).toBe('valid');
  });

  it('accepts a 500 character reason', async () => {
    const res = await revoke(HHT, CERT, 'alice', { reason: 'x'.repeat(500) });
    expect(res.statusCode).toBe(200);
  });
});

describe('revoke: tenant scoping', () => {
  it('alice revoking an LCL certificate is 404 via /tenants/3 and via /tenants/1; it stays valid', async () => {
    expectError(await revoke(LCL, LCL_CERT, 'alice', { reason: 'x' }), 404, 'NOT_FOUND');
    expectError(await revoke(HHT, LCL_CERT, 'alice', { reason: 'x' }), 404, 'NOT_FOUND');
    expect((await detailOf(LCL, LCL_CERT, 'bob')).status).toBe('valid');
    expect(revokeAudit(LCL_CERT)).toBe(0);
  });

  it('bob and carol cannot revoke across tenants', async () => {
    expectError(await revoke(HHT, CERT, 'bob', { reason: 'x' }), 404, 'NOT_FOUND');
    expectError(await revoke(LCL, LCL_CERT, 'carol', { reason: 'x' }), 404, 'NOT_FOUND');
    expectError(await revoke(2, CERT, 'alice', { reason: 'x' }), 404, 'NOT_FOUND'); // HHT cert via SRA
    expect((await detailOf(HHT, CERT)).status).toBe('valid');
  });

  it.each(['0', 'abc', '01', '-5', '999999'])('malformed or unknown certificate id %s -> 404', async (id) => {
    expectError(await revoke(HHT, id, 'alice', { reason: 'x' }), 404, 'NOT_FOUND');
  });

  it('no session -> 401', async () => {
    expectError(await revoke(HHT, CERT, null, { reason: 'x' }), 401, 'UNAUTHORIZED');
  });

  it('bob can revoke in his own tenant', async () => {
    const res = await revoke(LCL, LCL_CERT, 'bob', { reason: 'ok' });
    expect(res.statusCode).toBe(200);
    expect(certificateDetailSchema.parse(res.json()).revokedBy?.id).toBe('bob');
  });
});

describe('revoke: atomicity (SPEC §2.6 #1)', () => {
  it('if the audit insert fails, the certificate stays valid', async () => {
    faults.beforeRevokeAudit = () => {
      throw new Error('injected audit failure');
    };
    expectError(await revoke(HHT, CERT, 'alice', { reason: 'x' }), 500, 'INTERNAL_ERROR');
    const d = await detailOf(HHT, CERT);
    expect(d).toMatchObject({ status: 'valid', revokedAt: null, revokedBy: null, revokeReason: null });
    expect(revokeAudit(CERT)).toBe(0);

    // The connection is usable afterwards and the revoke succeeds once the fault is gone.
    faults.beforeRevokeAudit = undefined;
    expect((await revoke(HHT, CERT, 'alice', { reason: 'x' })).statusCode).toBe(200);
    expect(revokeAudit(CERT)).toBe(1);
  });
});
