import type { DatabaseSync } from 'node:sqlite';
import type { AdminRow, TenantRow } from './modules/session/repo';

declare module 'fastify' {
  interface FastifyInstance {
    db: DatabaseSync;
    now: () => Date;
    appEnv: string;
    /** Artificial per-item delay for bulk issue (ms); 0 in tests. */
    delayMs: number;
  }
  interface FastifyRequest {
    /** Set by the session guard on every authenticated route. */
    admin: AdminRow | null;
    /** Set by the session guard on routes with a `:tid` param the admin owns. */
    tenant: TenantRow | null;
  }
}
