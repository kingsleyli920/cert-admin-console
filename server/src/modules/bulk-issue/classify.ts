import type { RunItemReason } from '@cac/shared';

export interface EnrollmentFacts {
  certificateStatus: 'valid' | 'revoked' | null;
  enrollmentStatus: 'enrolled' | 'completed';
  learnerStatus: 'active' | 'inactive';
}

export type Classification =
  | { outcome: 'issued'; reason: null }
  | { outcome: 'skipped'; reason: Extract<RunItemReason, 'already_issued' | 'revoked' | 'not_completed'> }
  | { outcome: 'failed'; reason: Extract<RunItemReason, 'learner_inactive'> };

/**
 * Bulk-issue decision for one enrolled learner (SPEC §1.3). Conditions are checked in
 * order and the first match wins. Used both to preview course counts and by the runner.
 */
export function classifyEnrollment(facts: EnrollmentFacts): Classification {
  if (facts.certificateStatus === 'valid') return { outcome: 'skipped', reason: 'already_issued' };
  if (facts.certificateStatus === 'revoked') return { outcome: 'skipped', reason: 'revoked' };
  if (facts.enrollmentStatus !== 'completed') return { outcome: 'skipped', reason: 'not_completed' };
  if (facts.learnerStatus !== 'active') return { outcome: 'failed', reason: 'learner_inactive' };
  return { outcome: 'issued', reason: null };
}
