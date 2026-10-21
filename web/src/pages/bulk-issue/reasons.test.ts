import { runItemReasonSchema } from '@cac/shared';
import { describe, expect, it } from 'vitest';
import { REASON_TEXT, reasonText } from './reasons';

describe('reasonText', () => {
  it.each([
    ['already_issued', 'Already has a certificate'],
    ['revoked', 'Certificate was revoked'],
    ['not_completed', 'Course not completed'],
    ['learner_inactive', 'Learner account inactive'],
    ['internal_error', 'Unexpected error — try again'],
  ] as const)('maps %s to "%s"', (reason, text) => {
    expect(reasonText(reason)).toBe(text);
  });

  it('is empty for a null reason', () => {
    expect(reasonText(null)).toBe('');
  });

  it('covers every reason in the contract', () => {
    expect(Object.keys(REASON_TEXT).sort()).toEqual([...runItemReasonSchema.options].sort());
  });
});
