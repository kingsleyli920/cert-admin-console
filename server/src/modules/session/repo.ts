import type { DatabaseSync } from 'node:sqlite';

export interface AdminRow {
  id: string;
  name: string;
}

export interface TenantRow {
  id: number;
  code: string;
  name: string;
  timezone: string;
}

export function listAdmins(db: DatabaseSync): AdminRow[] {
  return db.prepare('SELECT id, name FROM admins ORDER BY id').all() as unknown as AdminRow[];
}

export function findAdmin(db: DatabaseSync, adminId: string): AdminRow | undefined {
  return db.prepare('SELECT id, name FROM admins WHERE id = ?').get(adminId) as unknown as AdminRow | undefined;
}

export function listTenantsForAdmin(db: DatabaseSync, adminId: string): TenantRow[] {
  return db
    .prepare(
      `SELECT t.id, t.code, t.name, t.timezone
         FROM tenants t JOIN admin_tenants at ON at.tenant_id = t.id
        WHERE at.admin_id = ?
        ORDER BY t.id`,
    )
    .all(adminId) as unknown as TenantRow[];
}

/** The tenant, only if this admin manages it. */
export function findTenantForAdmin(
  db: DatabaseSync,
  adminId: string,
  tenantId: number,
): TenantRow | undefined {
  return db
    .prepare(
      `SELECT t.id, t.code, t.name, t.timezone
         FROM tenants t JOIN admin_tenants at ON at.tenant_id = t.id
        WHERE at.admin_id = ? AND t.id = ?`,
    )
    .get(adminId, tenantId) as unknown as TenantRow | undefined;
}
