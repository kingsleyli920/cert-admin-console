import type { FastifyInstance } from 'fastify';
import { isUniqueViolation, inTransaction } from '../../db/tx';
import { classifyEnrollment } from './classify';
import {
  completeRun,
  findCertificateId,
  findSerialTenant,
  insertCertificate,
  insertIssueAudit,
  listRunningRuns,
  nextPendingLearner,
  readItemFacts,
  recordItem,
  type RunRow,
} from './repo';
import { allocateSerial, type SerialTenant } from './serial';

/** Test-only fault injection; never set in production. */
export interface RunnerFaults {
  /** Called inside the item's transaction right before it allocates a serial. May throw. */
  beforeIssue?: (learnerId: number) => void;
}

/**
 * In-process bulk-issue runner (SPEC §1.3). One async loop per run settles its `pending`
 * items one at a time, each in its own transaction, pausing `delayMs` in between. A run id is
 * processed by at most one loop at a time. Transactions never span an await.
 */
export class BulkIssueRunner {
  private readonly active = new Map<number, Promise<void>>();
  private readonly sleepers = new Set<() => void>();
  private stopping = false;

  constructor(
    private readonly app: FastifyInstance,
    private readonly faults: RunnerFaults = {},
  ) {}

  /** Starts processing a run unless it is already being processed or the runner is stopped. */
  start(run: RunRow): void {
    if (this.stopping || run.status !== 'running' || this.active.has(run.id)) return;
    const loop = this.process(run)
      .catch((err) => this.app.log.error({ err, runId: run.id }, 'bulk issue run aborted'))
      .finally(() => this.active.delete(run.id));
    this.active.set(run.id, loop);
  }

  /** SPEC §2.3 P2: continue every run left `running` by a previous process. */
  resumeAll(): void {
    for (const run of listRunningRuns(this.app.db)) this.start(run);
  }

  /** Lets in-flight items finish, schedules no new ones and waits for the loops to end. */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const wake of this.sleepers) wake();
    await Promise.all([...this.active.values()]);
  }

  private async process(run: RunRow): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve)); // never run inline in the caller
    const { db } = this.app;
    const tenant = findSerialTenant(db, run.tenantId);
    if (!tenant) throw new Error(`tenant ${run.tenantId} not found`);
    while (!this.stopping) {
      const learnerId = nextPendingLearner(db, run.tenantId, run.id);
      if (learnerId === undefined) {
        completeRun(db, run.tenantId, run.id);
        return;
      }
      this.settle(run, tenant, learnerId);
      await this.pause();
    }
  }

  /** After each item: sleep `delayMs`; with 0 still yield so other requests interleave. */
  private pause(): Promise<void> {
    const ms = this.app.delayMs;
    if (ms <= 0) return new Promise((resolve) => setImmediate(resolve));
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.sleepers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.sleepers.add(wake);
    });
  }

  /** Settles one pending item atomically: certificate + serial + audit + item row, or none. */
  private settle(run: RunRow, tenant: SerialTenant, learnerId: number): void {
    const { db } = this.app;
    try {
      inTransaction(db, () => {
        const facts = readItemFacts(db, run.tenantId, run.courseId, learnerId);
        const verdict = classifyEnrollment(facts);
        if (verdict.outcome !== 'issued') {
          // Skips for an existing certificate reference it; the others have none.
          recordItem(db, run.tenantId, run.id, learnerId, { ...verdict, certificateId: facts.certificateId });
          return;
        }
        this.faults.beforeIssue?.(learnerId);
        const issuedAt = this.app.now().toISOString();
        const serial = allocateSerial(db, tenant, issuedAt);
        const certificateId = insertCertificate(db, run.tenantId, {
          courseId: run.courseId,
          learnerId,
          serial,
          issuedAt,
          issuedBy: run.createdBy,
        });
        insertIssueAudit(db, run.tenantId, {
          actorId: run.createdBy,
          certificateId,
          courseId: run.courseId,
          learnerId,
          runId: run.id,
          createdAt: issuedAt,
        });
        recordItem(db, run.tenantId, run.id, learnerId, { outcome: 'issued', reason: null, certificateId });
      });
      return;
    } catch (err) {
      // The transaction was rolled back, so the serial counter was not consumed.
      if (isUniqueViolation(err) && this.recordLostRace(run, learnerId)) return;
      this.app.log.error({ err, runId: run.id, learnerId }, 'bulk issue item failed');
    }
    inTransaction(db, () =>
      recordItem(db, run.tenantId, run.id, learnerId, { outcome: 'failed', reason: 'internal_error', certificateId: null }),
    );
  }

  /** Another run issued this learner between our read and our insert: skip, referencing theirs. */
  private recordLostRace(run: RunRow, learnerId: number): boolean {
    const { db } = this.app;
    return inTransaction(db, () => {
      const certificateId = findCertificateId(db, run.tenantId, run.courseId, learnerId);
      if (certificateId === undefined) return false; // some other unique violation (e.g. serial)
      recordItem(db, run.tenantId, run.id, learnerId, { outcome: 'skipped', reason: 'already_issued', certificateId });
      return true;
    });
  }
}
