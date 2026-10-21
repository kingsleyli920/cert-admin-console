import { describe, expect, it } from 'vitest';
import { classifyEnrollment, type EnrollmentFacts } from '../../src/modules/bulk-issue/classify';

const base: EnrollmentFacts = {
  certificateStatus: null,
  enrollmentStatus: 'completed',
  learnerStatus: 'active',
};

// SPEC §1.3 — conditions are checked in this order; the first match wins.
describe('classifyEnrollment', () => {
  it.each<[string, Partial<EnrollmentFacts>, { outcome: string; reason: string | null }]>([
    ['completed, active, no certificate', {}, { outcome: 'issued', reason: null }],
    ['valid certificate exists', { certificateStatus: 'valid' }, { outcome: 'skipped', reason: 'already_issued' }],
    ['revoked certificate exists', { certificateStatus: 'revoked' }, { outcome: 'skipped', reason: 'revoked' }],
    ['enrollment not completed', { enrollmentStatus: 'enrolled' }, { outcome: 'skipped', reason: 'not_completed' }],
    ['learner inactive', { learnerStatus: 'inactive' }, { outcome: 'failed', reason: 'learner_inactive' }],
  ])('%s', (_label, facts, expected) => {
    expect(classifyEnrollment({ ...base, ...facts })).toEqual(expected);
  });

  it('reports an existing certificate before an unfinished enrollment', () => {
    expect(
      classifyEnrollment({ ...base, certificateStatus: 'valid', enrollmentStatus: 'enrolled' }),
    ).toEqual({ outcome: 'skipped', reason: 'already_issued' });
  });

  it('reports a revoked certificate before an inactive learner', () => {
    expect(
      classifyEnrollment({ ...base, certificateStatus: 'revoked', learnerStatus: 'inactive' }),
    ).toEqual({ outcome: 'skipped', reason: 'revoked' });
  });

  it('reports an unfinished enrollment before an inactive learner', () => {
    expect(
      classifyEnrollment({ ...base, enrollmentStatus: 'enrolled', learnerStatus: 'inactive' }),
    ).toEqual({ outcome: 'skipped', reason: 'not_completed' });
  });
});
