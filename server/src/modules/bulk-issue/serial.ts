import type { DatabaseSync } from 'node:sqlite';
import { tenantLocalYear } from '@cac/shared';

export interface SerialTenant {
  id: number;
  code: string;
  timezone: string;
}

/** `{CODE}-{YYYY}-{6-digit sequence}` (SPEC §1.2). */
export function formatSerial(code: string, year: number, sequence: number): string {
  return `${code}-${year}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Takes the tenant's next sequence number with one atomic UPDATE ... RETURNING and formats
 * the serial; `YYYY` is the year in the tenant's local time. Must run inside the same
 * transaction as the certificate insert, so a rollback gives the number back.
 */
export function allocateSerial(db: DatabaseSync, tenant: SerialTenant, nowIso: string): string {
  const row = db
    .prepare('UPDATE tenants SET next_serial = next_serial + 1 WHERE id = ? RETURNING next_serial - 1 AS seq')
    .get(tenant.id) as { seq: number } | undefined;
  if (!row) throw new Error(`tenant ${tenant.id} not found`);
  return formatSerial(tenant.code, tenantLocalYear(nowIso, tenant.timezone), row.seq);
}
