import type { BulkIssueRunItem, RunItemReason } from '@cac/shared';

export const REASON_TEXT: Record<RunItemReason, string> = {
  already_issued: 'Already has a certificate',
  revoked: 'Certificate was revoked',
  not_completed: 'Course not completed',
  learner_inactive: 'Learner account inactive',
  internal_error: 'Unexpected error — try again',
};

/** Plain-English reason for a run item; empty when the item has none (issued, pending). */
export const reasonText = (reason: BulkIssueRunItem['reason']): string =>
  reason ? REASON_TEXT[reason] : '';
