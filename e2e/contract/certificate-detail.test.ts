import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { certificateDetailSchema, errorResponseSchema } from '@cac/shared';
import { ACCESS_MATRIX, tenantById } from '../../server/test/helpers/access-matrix';
import { startRealServer, type RealServer } from '../../server/test/helpers/real-server';
import { ApiError, createApiClient } from '../../web/src/api/client';

// The web client against a real server process; raw bodies are re-parsed with the shared schemas
// so a client-side schema change cannot hide a server-side one.
let server: RealServer;
const cookies = new Map<string, string>();
beforeAll(async () => {
  server = await startRealServer();
  for (const { admin } of ACCESS_MATRIX) {
    const res = await fetch(`${server.url}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminId: admin }),
    });
    expect(res.status).toBe(204);
    cookies.set(admin, (res.headers.get('set-cookie') ?? '').split(';')[0]);
  }
});
afterAll(() => server.stop());

const clientFor = (admin?: string) =>
  createApiClient({ baseUrl: server.url, headers: admin ? { cookie: cookies.get(admin)! } : undefined });

async function raw(method: 'GET' | 'POST', path: string, admin?: string, body?: unknown): Promise<Response> {
  return fetch(`${server.url}${path}`, {
    method,
    headers: {
      ...(admin ? { cookie: cookies.get(admin)! } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectApiError(fn: () => Promise<unknown>, status: number, code: string): Promise<ApiError> {
  const err = await fn().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status, code });
  return err as ApiError;
}

async function expectRawError(res: Response, status: number, err: ApiError) {
  expect(res.status).toBe(status);
  expect(errorResponseSchema.parse(await res.json()).error).toEqual({ code: err.code, message: err.message });
}

// One seeded certificate per tenant: HHT 45 (DST edge), SRA 115 (same instant), LCL 1001 (first).
const SEEDED_CERT: Record<number, number> = { 1: 45, 2: 115, 3: 1001 };
const ALLOWED = ACCESS_MATRIX.flatMap(({ admin, allowed }) =>
  allowed
    .filter((tid) => tid in SEEDED_CERT)
    .map((tid) => ({ admin, tid, id: SEEDED_CERT[tid], code: tenantById(tid).code })),
);

describe('getCertificate', () => {
  it.each(ALLOWED)('$admin / $code: certificate $id parses and belongs to the tenant', async ({ admin, tid, id, code }) => {
    const cert = await clientFor(admin).getCertificate(tid, id);

    expect(cert).toMatchObject({ id, status: 'valid', revokedAt: null, revokedBy: null, revokeReason: null });
    expect(cert.serial.startsWith(`${code}-`)).toBe(true);
    expect(cert.audit.map((a) => a.action)).toEqual(['ISSUE']);

    const body = await (await raw('GET', `/api/tenants/${tid}/certificates/${id}`, admin)).json();
    expect(certificateDetailSchema.parse(body)).toEqual(cert);
  });
});

describe('revokeCertificate', () => {
  it('carol revokes the certificate alice issued: revokedBy carol, audit ISSUE(alice) then REVOKE(carol)', async () => {
    const cert = await clientFor('carol').revokeCertificate(1, 1, 'Duplicate record');

    expect(cert).toMatchObject({
      id: 1,
      status: 'revoked',
      issuedBy: { id: 'alice' },
      revokedBy: { id: 'carol', name: 'Carol Smith' },
      revokeReason: 'Duplicate record',
    });
    expect(cert.revokedAt).not.toBeNull();
    expect(cert.audit.map((a) => [a.action, a.actor.id])).toEqual([
      ['ISSUE', 'alice'],
      ['REVOKE', 'carol'],
    ]);

    // The change is visible to the other admin of the tenant, and the stored shape is the same.
    const again = await (await raw('GET', '/api/tenants/1/certificates/1', 'alice')).json();
    expect(certificateDetailSchema.parse(again)).toEqual(cert);
  });
});

describe('error responses', () => {
  it('revoking twice is 409 ALREADY_REVOKED with a schema-valid body', async () => {
    const api = clientFor('alice');
    await api.revokeCertificate(1, 2, 'First revoke');

    const err = await expectApiError(() => api.revokeCertificate(1, 2, 'Second revoke'), 409, 'ALREADY_REVOKED');
    await expectRawError(await raw('POST', '/api/tenants/1/certificates/2/revoke', 'alice', { reason: 'Third' }), 409, err);
    // The first reason is kept.
    expect((await api.getCertificate(1, 2)).revokeReason).toBe('First revoke');
  });

  it('an empty reason is 400 VALIDATION_ERROR and leaves the certificate valid', async () => {
    const res = await raw('POST', '/api/tenants/1/certificates/45/revoke', 'alice', { reason: '' });

    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect((await clientFor('alice').getCertificate(1, 45)).status).toBe('valid');
  });

  it("SRA's certificate 115 addressed through HHT is 404 NOT_FOUND, for detail and revoke", async () => {
    const detail = await expectApiError(() => clientFor('alice').getCertificate(1, 115), 404, 'NOT_FOUND');
    await expectRawError(await raw('GET', '/api/tenants/1/certificates/115', 'alice'), 404, detail);

    const revoke = await expectApiError(() => clientFor('alice').revokeCertificate(1, 115, 'Wrong tenant'), 404, 'NOT_FOUND');
    await expectRawError(await raw('POST', '/api/tenants/1/certificates/115/revoke', 'alice', { reason: 'Wrong tenant' }), 404, revoke);
    expect((await clientFor('alice').getCertificate(2, 115)).status).toBe('valid');
  });

  it('no cookie is 401 UNAUTHORIZED for detail and revoke', async () => {
    const detail = await expectApiError(() => clientFor().getCertificate(1, 45), 401, 'UNAUTHORIZED');
    await expectRawError(await raw('GET', '/api/tenants/1/certificates/45'), 401, detail);

    const revoke = await expectApiError(() => clientFor().revokeCertificate(1, 45, 'Nope'), 401, 'UNAUTHORIZED');
    await expectRawError(await raw('POST', '/api/tenants/1/certificates/45/revoke', undefined, { reason: 'Nope' }), 401, revoke);
  });
});
