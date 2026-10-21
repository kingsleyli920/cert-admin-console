import type { FastifyInstance, FastifyRequest } from 'fastify';
import { findAdmin, findTenantForAdmin, type AdminRow, type TenantRow } from '../modules/session/repo';
import { NotFoundError, UnauthorizedError } from './errors';

export const SESSION_COOKIE = 'cac_admin';

/** Routes that work without a session. HEAD is treated as GET. */
const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'GET /api/admins',
  'POST /api/session',
  'DELETE /api/session',
]);
const PUBLIC_PREFIXES = ['/api/__test__/'];

function isPublic(method: string, routeUrl: string): boolean {
  const effective = method === 'HEAD' ? 'GET' : method;
  return PUBLIC_ROUTES.has(`${effective} ${routeUrl}`) || PUBLIC_PREFIXES.some((p) => routeUrl.startsWith(p));
}

/** Strict positive integer; anything else is "no such tenant" (404), never a 400. */
function parseTenantId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Authenticates every `/api/*` route (except the public ones) from the `cac_admin` cookie and,
 * for routes with a `:tid` param, checks the admin manages that tenant.
 * Call before registering routes so the hook applies to all of them.
 */
export function registerSessionGuard(app: FastifyInstance): void {
  app.decorateRequest('admin', null);
  app.decorateRequest('tenant', null);

  app.addHook('onRequest', async (request) => {
    // Unmatched routes fall through to the 404 handler; they expose nothing.
    if (request.is404) return;
    const routeUrl = request.routeOptions.url ?? '';
    if (!routeUrl.startsWith('/api/') || isPublic(request.method, routeUrl)) return;

    const adminId = request.cookies[SESSION_COOKIE];
    const admin = adminId ? findAdmin(app.db, adminId) : undefined;
    if (!admin) throw new UnauthorizedError();
    request.admin = admin;

    const params = request.params as Record<string, unknown> | undefined;
    if (params && 'tid' in params) {
      const tenantId = parseTenantId(params.tid);
      const tenant = tenantId === null ? undefined : findTenantForAdmin(app.db, admin.id, tenantId);
      if (!tenant) throw new NotFoundError('Tenant not found');
      request.tenant = tenant;
    }
  });
}

/** For handlers behind the guard: the signed-in admin. */
export function requireAdmin(request: FastifyRequest): AdminRow {
  if (!request.admin) throw new UnauthorizedError();
  return request.admin;
}

/** For `/api/tenants/:tid/*` handlers: the tenant the guard verified for this admin. */
export function requireTenant(request: FastifyRequest): TenantRow {
  if (!request.tenant) throw new Error('requireTenant called on a route without a :tid guard');
  return request.tenant;
}
