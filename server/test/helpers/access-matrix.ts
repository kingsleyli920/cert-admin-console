import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { errorResponseSchema } from '@cac/shared';
import { signIn } from './app';

/**
 * Tenant × admin access matrix (SPEC §3.4), as data.
 *
 * Every tenant-scoped route (`/api/tenants/:tid/...`) must be listed in a
 * `describeAccessMatrix(...)` call so that isolation is checked for every admin and every
 * tenant, not for a hand-picked pair. Adding a route = adding one call; adding an admin or
 * tenant = editing this file only.
 */

export type AdminId = 'alice' | 'carol' | 'bob';

export interface SeedTenant {
  id: number;
  code: string;
  name: string;
  /** IANA timezone, as `/api/me` reports it. */
  timezone: string;
}

/** The four seeded tenants, ordered by id. */
export const TENANTS: readonly SeedTenant[] = [
  { id: 1, code: 'HHT', name: 'Harbour Health Training', timezone: 'Australia/Sydney' },
  { id: 2, code: 'SRA', name: 'Swan River Academy', timezone: 'Australia/Perth' },
  { id: 3, code: 'LCL', name: 'Large Corp Learning', timezone: 'Australia/Sydney' },
  { id: 4, code: 'NHI', name: 'New Horizons Institute', timezone: 'Australia/Brisbane' },
];

export const tenantById = (id: number): SeedTenant => {
  const tenant = TENANTS.find((t) => t.id === id);
  if (!tenant) throw new Error(`unknown seed tenant ${id}`);
  return tenant;
};

/**
 * Tenant ids that must be answered with 404 for every signed-in admin: non-existent
 * (`0`, `999`), not a number (`abc`), or not in canonical form (`01`, `-1`, `1.5`).
 * Never 400, so ids cannot be probed.
 */
export const MALFORMED_TENANT_IDS: readonly string[] = ['0', '999', 'abc', '01', '-1', '1.5'];

export interface AccessRow {
  admin: AdminId;
  /** Tenant ids the admin manages, ascending (what `/api/me` returns). */
  allowed: readonly number[];
  /** Every other seeded tenant id: must answer 404. */
  denied: readonly number[];
}

const ALL_IDS = TENANTS.map((t) => t.id);
const row = (admin: AdminId, allowed: number[]): AccessRow => ({
  admin,
  allowed,
  denied: ALL_IDS.filter((id) => !allowed.includes(id)),
});

export const ACCESS_MATRIX: readonly AccessRow[] = [
  row('alice', [1, 2, 4]), // HHT, SRA, NHI; LCL -> 404
  row('carol', [1]), // HHT only; SRA/LCL/NHI -> 404
  row('bob', [3]), // LCL only; HHT/SRA/NHI -> 404
];

export interface AllowedContext {
  admin: AdminId;
  tenant: SeedTenant;
}

export interface AccessMatrixOptions {
  /** JSON body for POST/PUT/PATCH routes. */
  payload?: unknown;
  /** Extra checks for an allowed (admin, tenant) pair, e.g. the tenant echoed by the route. */
  expectAllowed?: (res: LightMyRequestResponse, ctx: AllowedContext) => void;
  /** Status for an allowed pair. Defaults to 200. */
  allowedStatus?: number;
}

function expectError(res: LightMyRequestResponse, status: number, code: string): void {
  expect(res.statusCode).toBe(status);
  expect(errorResponseSchema.parse(res.json()).error.code).toBe(code);
}

/**
 * Generates one vitest case per (admin, tenant) pair and per no-session request for a route.
 *
 * @param template  `"METHOD /api/tenants/:tid/..."`; `:tid` is replaced per case.
 * @param getApp    Returns the app of the current test (called lazily, inside each case).
 *
 * Expectations:
 *  - managed tenant            -> `allowedStatus` (default 200), then `expectAllowed`
 *  - another seeded tenant     -> 404 NOT_FOUND (never 403)
 *  - malformed / unknown id    -> 404 NOT_FOUND (never 400)
 *  - no session, any tenant id -> 401 UNAUTHORIZED
 * Error bodies must satisfy the shared `errorResponseSchema`.
 *
 * Out of scope here (test per route): resources of another tenant addressed through an
 * allowed tenant id, which must also be 404.
 *
 * @example
 * describeAccessMatrix('GET /api/tenants/:tid/ping', () => app, {
 *   expectAllowed: (res, { tenant }) => expect(res.json().tenant.code).toBe(tenant.code),
 * });
 */
export function describeAccessMatrix(
  template: string,
  getApp: () => FastifyInstance,
  options: AccessMatrixOptions = {},
): void {
  const [method, path] = template.split(' ');
  if (!method || !path?.includes(':tid')) throw new Error(`bad route template: ${template}`);
  const { payload, expectAllowed, allowedStatus = 200 } = options;
  const send = (tid: string, cookie?: string): Promise<LightMyRequestResponse> =>
    getApp().inject({
      method: method as 'GET',
      url: path.replace(':tid', tid),
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  describe(`access matrix: ${template}`, () => {
    for (const { admin, allowed, denied } of ACCESS_MATRIX) {
      describe(admin, () => {
        for (const id of allowed) {
          const tenant = tenantById(id);
          it(`tenant ${id} (${tenant.code}) -> ${allowedStatus}`, async () => {
            const res = await send(String(id), await signIn(getApp(), admin));
            expect(res.statusCode).toBe(allowedStatus);
            expectAllowed?.(res, { admin, tenant });
          });
        }
        for (const id of denied) {
          it(`tenant ${id} (${tenantById(id).code}) -> 404 NOT_FOUND`, async () => {
            expectError(await send(String(id), await signIn(getApp(), admin)), 404, 'NOT_FOUND');
          });
        }
        for (const tid of MALFORMED_TENANT_IDS) {
          it(`malformed tenant id "${tid}" -> 404 NOT_FOUND`, async () => {
            expectError(await send(tid, await signIn(getApp(), admin)), 404, 'NOT_FOUND');
          });
        }
      });
    }

    describe('no session', () => {
      for (const tid of [...ALL_IDS.map(String), ...MALFORMED_TENANT_IDS]) {
        it(`tenant id "${tid}" -> 401 UNAUTHORIZED`, async () => {
          expectError(await send(tid), 401, 'UNAUTHORIZED');
        });
      }
    });
  });
}
