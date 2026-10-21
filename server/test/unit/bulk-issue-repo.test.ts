import { describe, expect, it } from 'vitest';
import { bulkIssueRunSchema } from '@cac/shared';
import { SEED_IDS } from '../../src/db/seed';
import { createRun, getRunView, recordItem } from '../../src/modules/bulk-issue/repo';
import { createTestDb } from '../helpers/db';

const HHT = SEED_IDS.tenants.hht;
const FIRE = SEED_IDS.courses.fireSafety2026;
const FS = SEED_IDS.learners.fireSafety;
const KEY = '3f2b8c1e-9d4a-4f6b-8a57-1c2d3e4f5a6b';
const NEW = { courseId: FIRE, idempotencyKey: KEY, createdBy: 'alice', createdAt: '2026-10-20T01:00:00.000Z' };

describe('createRun', () => {
  it('creates a running run with one pending item per enrollment', () => {
    const db = createTestDb();
    const result = createRun(db, HHT, NEW);
    expect(result.kind).toBe('created');
    const run = getRunView(db, HHT, (result as { runId: number }).runId)!;
    expect(bulkIssueRunSchema.safeParse(run).success).toBe(true);
    expect(run).toMatchObject({
      status: 'running',
      courseTitle: 'Fire Safety 2026',
      createdBy: { id: 'alice', name: 'Alice Nguyen' },
      createdAt: NEW.createdAt,
      total: 16,
      processed: 0,
      counts: { issued: 0, skipped: 0, failed: 0, pending: 16 },
    });
  });

  it('replays the same run for the same key and course, without new items', () => {
    const db = createTestDb();
    const first = createRun(db, HHT, NEW);
    const again = createRun(db, HHT, { ...NEW, createdBy: 'carol' });
    expect(again).toEqual({ kind: 'replayed', runId: (first as { runId: number }).runId });
    expect((db.prepare('SELECT COUNT(*) AS n FROM bulk_issue_run_items').get() as { n: number }).n).toBe(16);
  });

  it('reports key reuse for a different course and leaves no trace', () => {
    const db = createTestDb();
    createRun(db, HHT, NEW);
    expect(createRun(db, HHT, { ...NEW, courseId: SEED_IDS.courses.manualHandling })).toEqual({ kind: 'key_reused' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM bulk_issue_runs').get() as { n: number }).n).toBe(1);
    expect(db.isTransaction).toBe(false);
  });

  it('scopes keys per tenant', () => {
    const db = createTestDb();
    createRun(db, HHT, NEW);
    const other = createRun(db, SEED_IDS.tenants.sra, { ...NEW, courseId: SEED_IDS.courses.sraFoodSafetyBasics });
    expect(other.kind).toBe('created');
  });

  it('completes immediately when the course has no enrollments', () => {
    const db = createTestDb();
    db.prepare("INSERT INTO courses (id, tenant_id, title) VALUES (199, ?, 'Empty')").run(HHT);
    const result = createRun(db, HHT, { ...NEW, courseId: 199 });
    expect(getRunView(db, HHT, (result as { runId: number }).runId)).toMatchObject({ status: 'completed', total: 0, items: [] });
  });
});

describe('getRunView', () => {
  it('maps items ordered by learner name then id, with existing-certificate references', () => {
    const db = createTestDb();
    const runId = (createRun(db, HHT, NEW) as { runId: number }).runId;
    recordItem(db, HHT, runId, FS.valid[0], { outcome: 'skipped', reason: 'already_issued', certificateId: 1 });
    recordItem(db, HHT, runId, FS.revoked, { outcome: 'skipped', reason: 'revoked', certificateId: 3 });
    recordItem(db, HHT, runId, FS.completedInactive, { outcome: 'failed', reason: 'learner_inactive', certificateId: null });

    const run = getRunView(db, HHT, runId)!;
    const names = run.items.map((i) => i.learnerName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || 0));
    expect(run.counts).toEqual({ issued: 0, skipped: 2, failed: 1, pending: 13 });
    expect(run.processed).toBe(3);
    const byId = (id: number) => run.items.find((i) => i.learnerId === id)!;
    expect(byId(FS.valid[0])).toMatchObject({ certificateId: 1, serial: expect.stringMatching(/^HHT-\d{4}-\d{6}$/) });
    expect(byId(FS.revoked)).toMatchObject({ reason: 'revoked', certificateId: 3 });
    expect(byId(FS.completedInactive)).toMatchObject({ certificateId: null, serial: null });
    expect(byId(FS.completedNoCert[0])).toMatchObject({ outcome: 'pending', reason: null, certificateId: null });
  });

  it('does not settle an item twice', () => {
    const db = createTestDb();
    const runId = (createRun(db, HHT, NEW) as { runId: number }).runId;
    recordItem(db, HHT, runId, FS.revoked, { outcome: 'skipped', reason: 'revoked', certificateId: 3 });
    recordItem(db, HHT, runId, FS.revoked, { outcome: 'failed', reason: 'internal_error', certificateId: null });
    expect(getRunView(db, HHT, runId)!.items.find((i) => i.learnerId === FS.revoked)).toMatchObject({ outcome: 'skipped' });
  });

  it('is invisible to other tenants', () => {
    const db = createTestDb();
    const runId = (createRun(db, HHT, NEW) as { runId: number }).runId;
    expect(getRunView(db, SEED_IDS.tenants.sra, runId)).toBeUndefined();
  });
});
