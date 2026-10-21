import type { DatabaseSync } from 'node:sqlite';
import type { BulkIssueRun, RunItemReason } from '@cac/shared';
import { inTransaction, isUniqueViolation } from '../../db/tx';
import type { EnrollmentFacts } from './classify';
import type { SerialTenant } from './serial';

export interface RunRow {
  id: number;
  tenantId: number;
  courseId: number;
  createdBy: string;
  createdAt: string;
  status: 'running' | 'completed';
}

export type CreateRunResult =
  | { kind: 'created'; runId: number }
  | { kind: 'replayed'; runId: number }
  | { kind: 'key_reused' };

export interface NewRun {
  courseId: number;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Claims the Idempotency-Key and creates the run with all its `pending` items in ONE
 * transaction (SPEC §1.3, §2.6 #1). The claim is the INSERT itself: the UNIQUE
 * (tenant_id, idempotency_key) constraint decides, never a prior SELECT.
 */
export function createRun(db: DatabaseSync, tenantId: number, input: NewRun): CreateRunResult {
  try {
    const runId = inTransaction(db, () => {
      const inserted = db
        .prepare(
          `INSERT INTO bulk_issue_runs (tenant_id, course_id, idempotency_key, created_by, created_at, status)
           VALUES (?, ?, ?, ?, ?, 'running')`,
        )
        .run(tenantId, input.courseId, input.idempotencyKey, input.createdBy, input.createdAt);
      const id = Number(inserted.lastInsertRowid);
      const items = db
        .prepare(
          `INSERT INTO bulk_issue_run_items (run_id, learner_id, outcome)
           SELECT ?, e.learner_id, 'pending' FROM enrollments e WHERE e.tenant_id = ? AND e.course_id = ?`,
        )
        .run(id, tenantId, input.courseId);
      if (items.changes === 0) {
        db.prepare("UPDATE bulk_issue_runs SET status = 'completed' WHERE id = ? AND tenant_id = ?").run(id, tenantId);
      }
      return id;
    });
    return { kind: 'created', runId };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  // The key is already claimed (rolled back above): replay that run if it is for the same course.
  const existing = db
    .prepare('SELECT id, course_id FROM bulk_issue_runs WHERE tenant_id = ? AND idempotency_key = ?')
    .get(tenantId, input.idempotencyKey) as { id: number; course_id: number } | undefined;
  if (!existing) throw new Error('idempotency key conflict without an existing run');
  return existing.course_id === input.courseId ? { kind: 'replayed', runId: existing.id } : { kind: 'key_reused' };
}

export function courseExists(db: DatabaseSync, tenantId: number, courseId: number): boolean {
  return db.prepare('SELECT 1 AS ok FROM courses WHERE id = ? AND tenant_id = ?').get(courseId, tenantId) !== undefined;
}

interface RawRun {
  id: number;
  tenant_id: number;
  course_id: number;
  created_by: string;
  created_at: string;
  status: 'running' | 'completed';
}
const toRunRow = (r: RawRun): RunRow => ({
  id: r.id,
  tenantId: r.tenant_id,
  courseId: r.course_id,
  createdBy: r.created_by,
  createdAt: r.created_at,
  status: r.status,
});

export function findRun(db: DatabaseSync, tenantId: number, runId: number): RunRow | undefined {
  const row = db
    .prepare('SELECT id, tenant_id, course_id, created_by, created_at, status FROM bulk_issue_runs WHERE id = ? AND tenant_id = ?')
    .get(runId, tenantId) as RawRun | undefined;
  return row && toRunRow(row);
}

/** Startup recovery (SPEC §2.3 P2): every tenant's runs that still have work to do. */
export function listRunningRuns(db: DatabaseSync): RunRow[] {
  const rows = db
    .prepare("SELECT id, tenant_id, course_id, created_by, created_at, status FROM bulk_issue_runs WHERE status = 'running' ORDER BY id")
    .all() as unknown as RawRun[];
  return rows.map(toRunRow);
}

/** Next `pending` learner of the run, ordered like the result table (name, then id). */
export function nextPendingLearner(db: DatabaseSync, tenantId: number, runId: number): number | undefined {
  const row = db
    .prepare(
      `SELECT i.learner_id
         FROM bulk_issue_run_items i
         JOIN bulk_issue_runs r ON r.id = i.run_id AND r.tenant_id = ?
         JOIN learners l ON l.id = i.learner_id AND l.tenant_id = r.tenant_id
        WHERE i.run_id = ? AND i.outcome = 'pending'
        ORDER BY l.name COLLATE NOCASE, l.id
        LIMIT 1`,
    )
    .get(tenantId, runId) as { learner_id: number } | undefined;
  return row?.learner_id;
}

export interface ItemFacts extends EnrollmentFacts {
  /** The existing certificate for (tenant, course, learner), if any. */
  certificateId: number | null;
}

/** Re-reads the facts the classifier needs, inside the item's transaction. */
export function readItemFacts(db: DatabaseSync, tenantId: number, courseId: number, learnerId: number): ItemFacts {
  const row = db
    .prepare(
      `SELECT e.status AS enrollment_status, l.status AS learner_status, c.id AS certificate_id, c.status AS certificate_status
         FROM enrollments e
         JOIN learners l ON l.id = e.learner_id AND l.tenant_id = e.tenant_id
         LEFT JOIN certificates c ON c.tenant_id = e.tenant_id AND c.course_id = e.course_id AND c.learner_id = e.learner_id
        WHERE e.tenant_id = ? AND e.course_id = ? AND e.learner_id = ?`,
    )
    .get(tenantId, courseId, learnerId) as
    | {
        enrollment_status: 'enrolled' | 'completed';
        learner_status: 'active' | 'inactive';
        certificate_id: number | null;
        certificate_status: 'valid' | 'revoked' | null;
      }
    | undefined;
  if (!row) throw new Error(`no enrollment for learner ${learnerId} in course ${courseId}`);
  return {
    enrollmentStatus: row.enrollment_status,
    learnerStatus: row.learner_status,
    certificateStatus: row.certificate_status,
    certificateId: row.certificate_id,
  };
}

export function findCertificateId(db: DatabaseSync, tenantId: number, courseId: number, learnerId: number): number | undefined {
  const row = db
    .prepare('SELECT id FROM certificates WHERE tenant_id = ? AND course_id = ? AND learner_id = ?')
    .get(tenantId, courseId, learnerId) as { id: number } | undefined;
  return row?.id;
}

export interface ItemResult {
  outcome: 'issued' | 'skipped' | 'failed';
  reason: RunItemReason | null;
  certificateId: number | null;
}

/** Records a `pending` item's outcome. A no-op if the item was already settled. */
export function recordItem(db: DatabaseSync, tenantId: number, runId: number, learnerId: number, result: ItemResult): void {
  db.prepare(
    `UPDATE bulk_issue_run_items SET outcome = ?, reason = ?, certificate_id = ?
      WHERE run_id = ? AND learner_id = ? AND outcome = 'pending'
        AND run_id IN (SELECT id FROM bulk_issue_runs WHERE id = ? AND tenant_id = ?)`,
  ).run(result.outcome, result.reason, result.certificateId, runId, learnerId, runId, tenantId);
}

export function completeRun(db: DatabaseSync, tenantId: number, runId: number): void {
  db.prepare("UPDATE bulk_issue_runs SET status = 'completed' WHERE id = ? AND tenant_id = ?").run(runId, tenantId);
}

/** The `BulkIssueRun` read model (SPEC §2.4) for a run of this tenant. */
export function getRunView(db: DatabaseSync, tenantId: number, runId: number): BulkIssueRun | undefined {
  const run = db
    .prepare(
      `SELECT r.id, r.course_id, r.status, r.created_at, r.created_by, a.name AS admin_name, co.title AS course_title
         FROM bulk_issue_runs r
         JOIN admins a ON a.id = r.created_by
         JOIN courses co ON co.id = r.course_id AND co.tenant_id = r.tenant_id
        WHERE r.id = ? AND r.tenant_id = ?`,
    )
    .get(runId, tenantId) as
    | { id: number; course_id: number; status: 'running' | 'completed'; created_at: string; created_by: string; admin_name: string; course_title: string }
    | undefined;
  if (!run) return undefined;

  const rows = db
    .prepare(
      `SELECT i.learner_id, l.name AS learner_name, i.outcome, i.reason, i.certificate_id, c.serial
         FROM bulk_issue_run_items i
         JOIN bulk_issue_runs r ON r.id = i.run_id AND r.tenant_id = ?
         JOIN learners l ON l.id = i.learner_id AND l.tenant_id = r.tenant_id
         LEFT JOIN certificates c ON c.id = i.certificate_id AND c.tenant_id = r.tenant_id
        WHERE i.run_id = ?
        ORDER BY l.name COLLATE NOCASE, l.id`,
    )
    .all(tenantId, runId) as unknown as Array<{
    learner_id: number;
    learner_name: string;
    outcome: 'pending' | 'issued' | 'skipped' | 'failed';
    reason: RunItemReason | null;
    certificate_id: number | null;
    serial: string | null;
  }>;

  const counts = { issued: 0, skipped: 0, failed: 0, pending: 0 };
  for (const row of rows) counts[row.outcome] += 1;
  return {
    id: run.id,
    courseId: run.course_id,
    courseTitle: run.course_title,
    status: run.status,
    createdAt: run.created_at,
    createdBy: { id: run.created_by, name: run.admin_name },
    total: rows.length,
    processed: rows.length - counts.pending,
    counts,
    items: rows.map((row) => ({
      learnerId: row.learner_id,
      learnerName: row.learner_name,
      outcome: row.outcome,
      reason: row.reason,
      certificateId: row.certificate_id,
      serial: row.serial,
    })),
  };
}

export function findSerialTenant(db: DatabaseSync, tenantId: number): SerialTenant | undefined {
  return db.prepare('SELECT id, code, timezone FROM tenants WHERE id = ?').get(tenantId) as SerialTenant | undefined;
}

export interface NewCertificate {
  courseId: number;
  learnerId: number;
  serial: string;
  issuedAt: string;
  issuedBy: string;
}

/** Throws a UNIQUE violation (errcode 2067) if the (tenant, course, learner) slot is taken. */
export function insertCertificate(db: DatabaseSync, tenantId: number, c: NewCertificate): number {
  const res = db
    .prepare(
      `INSERT INTO certificates (tenant_id, course_id, learner_id, serial, issued_at, issued_by, status)
       VALUES (?, ?, ?, ?, ?, ?, 'valid')`,
    )
    .run(tenantId, c.courseId, c.learnerId, c.serial, c.issuedAt, c.issuedBy);
  return Number(res.lastInsertRowid);
}

export interface NewIssueAudit {
  actorId: string;
  certificateId: number;
  courseId: number;
  learnerId: number;
  runId: number;
  createdAt: string;
}

export function insertIssueAudit(db: DatabaseSync, tenantId: number, a: NewIssueAudit): void {
  db.prepare(
    `INSERT INTO audit_logs (tenant_id, actor_id, action, certificate_id, course_id, learner_id, run_id, created_at)
     VALUES (?, ?, 'ISSUE', ?, ?, ?, ?, ?)`,
  ).run(tenantId, a.actorId, a.certificateId, a.courseId, a.learnerId, a.runId, a.createdAt);
}
