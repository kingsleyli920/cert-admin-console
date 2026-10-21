import type { BulkIssueRun, BulkIssueRunItem, CourseSummary } from '@cac/shared';
import { http, HttpResponse } from 'msw';
import { alice } from './fixtures';
import { server } from './msw';

/** Spec 1.3 example: 16 enrolled, 8 eligible, 3 already issued, 4 not completed, 1 inactive. */
export const fireSafety: CourseSummary = {
  id: 1,
  title: 'Fire Safety 2026',
  enrolled: 16,
  counts: { eligible: 8, alreadyIssued: 3, notCompleted: 4, inactive: 1 },
};

export const RUN_ID = 77;
export const RUN_CREATED_AT = '2026-04-04T14:30:00.000Z'; // Sydney: 5 Apr 2026, 1:30 am AEDT

type Final = Pick<BulkIssueRunItem, 'outcome' | 'reason' | 'certificateId' | 'serial'>;
const issued = (n: number): Final => ({
  outcome: 'issued',
  reason: null,
  certificateId: 500 + n,
  serial: `HHT-2026-${String(500 + n).padStart(6, '0')}`,
});
const existing = (id: number): Final => ({
  outcome: 'skipped',
  reason: 'already_issued',
  certificateId: id,
  serial: `HHT-2026-${String(id).padStart(6, '0')}`,
});
const notCompleted: Final = { outcome: 'skipped', reason: 'not_completed', certificateId: null, serial: null };
const inactive: Final = { outcome: 'failed', reason: 'learner_inactive', certificateId: null, serial: null };

/** Final outcome per learner, already in the server's order (learner name). */
const FINAL: Array<[string, Final]> = [
  ['Ava Thompson', issued(1)],
  ['Chloe Davis', issued(2)],
  ['Ethan Brown', issued(3)],
  ['Grace Lee', issued(4)],
  ['Henry Clarke', existing(301)],
  ['Isla Young', inactive],
  ['Jack Taylor', issued(5)],
  ['Leo Walker', notCompleted],
  ['Liam Murphy', issued(6)],
  ['Lucas Nguyen', notCompleted],
  ['Mia Johnson', issued(7)],
  ['Noah Patel', issued(8)],
  ['Olivia Chen', existing(302)],
  ['Oscar White', notCompleted],
  ['Ruby Harris', notCompleted],
  ['Zoe Martin', existing(303)],
];

/** The Fire Safety run after `processed` items: finished items first, the rest pending. */
export function buildRun(processed: number, id = RUN_ID): BulkIssueRun {
  const items: BulkIssueRunItem[] = FINAL.map(([learnerName, final], i) => ({
    learnerId: 1000 + i,
    learnerName,
    ...(i < processed ? final : { outcome: 'pending', reason: null, certificateId: null, serial: null }),
  }));
  const count = (outcome: BulkIssueRunItem['outcome']) => items.filter((it) => it.outcome === outcome).length;
  return {
    id,
    courseId: fireSafety.id,
    courseTitle: fireSafety.title,
    status: processed >= items.length ? 'completed' : 'running',
    createdAt: RUN_CREATED_AT,
    createdBy: alice,
    total: items.length,
    processed,
    counts: { issued: count('issued'), skipped: count('skipped'), failed: count('failed'), pending: count('pending') },
    items,
  };
}

export type PostBehaviour =
  | 'ok'
  | 'network-error'
  | { status: number; code: string; message: string };

export interface BulkIssueBackend {
  /** Every POST /bulk-issue received (including ones answered with a network error). */
  posts: Array<{ tid: number; courseId: number; key: string | null }>;
  /** Run ids of every GET /bulk-issue-runs/:id, in order. */
  gets: number[];
}

/**
 * Stateful stand-in for the bulk-issue endpoints. POSTs consume `post` behaviours in order
 * (then succeed); a successful POST creates run RUN_ID (or replays it for a repeated key).
 * Each GET of a running run advances it by one item. `preloaded` runs exist from the start
 * (id -> processed count).
 */
export function mockBulkIssueBackend(
  opts: {
    post?: PostBehaviour[];
    preloaded?: Record<number, number>;
    courses?: CourseSummary[];
    postDelayMs?: number;
  } = {},
): BulkIssueBackend {
  const backend: BulkIssueBackend = { posts: [], gets: [] };
  const behaviours = [...(opts.post ?? [])];
  const processed = new Map<number, number>(Object.entries(opts.preloaded ?? {}).map(([k, v]) => [Number(k), v]));
  const byKey = new Map<string, number>();

  server.use(
    http.get('/api/tenants/:tid/courses', () => HttpResponse.json({ items: opts.courses ?? [fireSafety] })),
    http.post('/api/tenants/:tid/courses/:cid/bulk-issue', async ({ request, params }) => {
      const key = request.headers.get('idempotency-key');
      backend.posts.push({ tid: Number(params.tid), courseId: Number(params.cid), key });
      if (opts.postDelayMs) await new Promise((r) => setTimeout(r, opts.postDelayMs));
      const next = behaviours.shift() ?? 'ok';
      if (next === 'network-error') return HttpResponse.error();
      if (next !== 'ok') {
        return HttpResponse.json({ error: { code: next.code, message: next.message } }, { status: next.status });
      }
      const id = (key && byKey.get(key)) || RUN_ID;
      if (key) byKey.set(key, id);
      if (!processed.has(id)) processed.set(id, 0);
      return HttpResponse.json({ run: buildRun(processed.get(id)!, id) }, { status: 202 });
    }),
    http.get('/api/tenants/:tid/bulk-issue-runs/:runId', ({ params }) => {
      const id = Number(params.runId);
      backend.gets.push(id);
      if (!processed.has(id)) {
        return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Run not found' } }, { status: 404 });
      }
      const next = Math.min(processed.get(id)! + 1, FINAL.length);
      // A completed run stays as it is; a running one moves on by one item per GET.
      if (processed.get(id)! < FINAL.length) processed.set(id, next);
      return HttpResponse.json({ run: buildRun(processed.get(id)!, id) });
    }),
  );
  return backend;
}
