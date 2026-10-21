import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { certificateDetailSchema, errorResponseSchema } from '@cac/shared';
import { startRealServer, type RealServer } from '../helpers/real-server';

let server: RealServer;
const cookies: Record<string, string> = {};
beforeAll(async () => {
  server = await startRealServer();
  for (const adminId of ['alice', 'carol']) {
    const res = await fetch(`${server.url}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminId }),
    });
    expect(res.status).toBe(204);
    cookies[adminId] = (res.headers.get('set-cookie') ?? '').split(';')[0];
  }
});
afterAll(() => server.stop());

const url = (id: number) => `${server.url}/api/tenants/1/certificates/${id}`;
const getDetail = (admin: string, id: number) => fetch(url(id), { headers: { cookie: cookies[admin] } });
const revoke = (admin: string, id: number, reason: string) =>
  fetch(`${url(id)}/revoke`, {
    method: 'POST',
    headers: { cookie: cookies[admin], 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  });

describe('certificate detail and revoke over a real server process (HHT)', () => {
  it('revokes, shows the revoked detail with both actors, and rejects a second revoke with 409', async () => {
    const before = certificateDetailSchema.parse(await (await getDetail('alice', 2)).json());
    expect(before).toMatchObject({ status: 'valid', revokedBy: null });

    const res = await revoke('carol', 2, 'Duplicate enrolment');
    expect(res.status).toBe(200);
    const revoked = certificateDetailSchema.parse(await res.json());
    expect(revoked).toMatchObject({
      status: 'revoked',
      issuedBy: { id: 'alice' },
      revokedBy: { id: 'carol' },
      revokeReason: 'Duplicate enrolment',
    });

    const read = await getDetail('alice', 2);
    expect(read.status).toBe(200);
    const detail = certificateDetailSchema.parse(await read.json());
    expect(detail).toEqual(revoked);
    expect(detail.audit.map((a) => [a.action, a.actor.id])).toEqual([
      ['ISSUE', 'alice'],
      ['REVOKE', 'carol'],
    ]);

    const again = await revoke('alice', 2, 'Again');
    expect(again.status).toBe(409);
    expect(errorResponseSchema.parse(await again.json()).error.code).toBe('ALREADY_REVOKED');
    expect(certificateDetailSchema.parse(await (await getDetail('alice', 2)).json())).toEqual(revoked);
  });

  it('an empty reason is 400 and a foreign tenant certificate is 404', async () => {
    const bad = await revoke('alice', 1, '  ');
    expect(bad.status).toBe(400);
    expect(errorResponseSchema.parse(await bad.json()).error.code).toBe('VALIDATION_ERROR');
    expect((await getDetail('alice', 1001)).status).toBe(404); // LCL certificate through HHT
  });
});
