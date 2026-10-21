import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { certificateListResponseSchema, coursesResponseSchema } from '@cac/shared';
import { startRealServer, type RealServer } from '../helpers/real-server';

async function signIn(server: RealServer, adminId: string): Promise<string> {
  const res = await fetch(`${server.url}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adminId }),
  });
  expect(res.status).toBe(204);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

describe('certificate list and courses over a real server process (LCL, 8000 certificates)', () => {
  let server: RealServer;
  let bob: string;
  beforeAll(async () => {
    server = await startRealServer();
    bob = await signIn(server, 'bob');
  });
  afterAll(() => server.stop());

  async function timed(path: string): Promise<{ body: unknown; ms: number }> {
    const started = performance.now();
    const res = await fetch(`${server.url}${path}`, { headers: { cookie: bob } });
    const body = await res.json();
    const ms = performance.now() - started;
    expect(res.status, JSON.stringify(body)).toBe(200);
    return { body, ms };
  }

  it('lists page 1 (20 items, total 8000) in under 500 ms', async () => {
    const { body, ms } = await timed('/api/tenants/3/certificates');
    const page = certificateListResponseSchema.parse(body);
    expect(page).toMatchObject({ total: 8000, page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(20);
    expect(ms).toBeLessThan(500);
  });

  it('lists page 400 (the last page of 20) in under 500 ms', async () => {
    const { body, ms } = await timed('/api/tenants/3/certificates?page=400');
    const page = certificateListResponseSchema.parse(body);
    expect(page).toMatchObject({ total: 8000, page: 400 });
    expect(page.items).toHaveLength(20);
    expect(ms).toBeLessThan(500);
  });

  it.each(['learnerName', 'courseTitle', 'serial'])('lists a deep page sorted by %s in under 500 ms', async (sort) => {
    const { body, ms } = await timed(`/api/tenants/3/certificates?sort=${sort}&order=asc&page=400`);
    expect(certificateListResponseSchema.parse(body).items).toHaveLength(20);
    expect(ms).toBeLessThan(500);
  });

  it('searches by name over all 8000 rows in under 500 ms', async () => {
    const { body, ms } = await timed('/api/tenants/3/certificates?q=smith');
    expect(certificateListResponseSchema.parse(body).total).toBeGreaterThan(0);
    expect(ms).toBeLessThan(500);
  });

  it('computes course counts over 8000 enrollments in under 500 ms', async () => {
    const { body, ms } = await timed('/api/tenants/3/courses');
    const { items } = coursesResponseSchema.parse(body);
    expect(items).toHaveLength(20);
    expect(items.every((c) => c.enrolled === 400 && c.counts.alreadyIssued === 400)).toBe(true);
    expect(ms).toBeLessThan(500);
  });
});
