import type { DatabaseSync } from 'node:sqlite';
import type { CourseSummary } from '@cac/shared';
import { classifyEnrollment } from '../bulk-issue/classify';

interface FactRow {
  course_id: number;
  title: string;
  enrollment_status: 'enrolled' | 'completed' | null;
  learner_status: 'active' | 'inactive' | null;
  certificate_status: 'valid' | 'revoked' | null;
}

/**
 * Every course of the tenant with its enrolment distribution (SPEC §2.4). One query returns
 * the facts of every enrolment (a course without enrolments yields a single NULL row); the
 * bulk-issue classifier then buckets them, so previews and runs agree by construction.
 */
export function listCoursesWithCounts(db: DatabaseSync, tenantId: number): CourseSummary[] {
  const rows = db
    .prepare(
      `SELECT co.id AS course_id, co.title,
              e.status AS enrollment_status, l.status AS learner_status, c.status AS certificate_status
         FROM courses co
         LEFT JOIN enrollments e   ON e.course_id = co.id AND e.tenant_id = co.tenant_id
         LEFT JOIN learners l      ON l.id = e.learner_id AND l.tenant_id = co.tenant_id
         LEFT JOIN certificates c  ON c.course_id = co.id AND c.learner_id = e.learner_id
                                  AND c.tenant_id = co.tenant_id
        WHERE co.tenant_id = ?
        ORDER BY co.title COLLATE NOCASE, co.id`,
    )
    .all(tenantId) as unknown as FactRow[];

  const byCourse = new Map<number, CourseSummary>();
  for (const row of rows) {
    let course = byCourse.get(row.course_id);
    if (!course) {
      course = {
        id: row.course_id,
        title: row.title,
        enrolled: 0,
        counts: { eligible: 0, alreadyIssued: 0, notCompleted: 0, inactive: 0 },
      };
      byCourse.set(row.course_id, course);
    }
    if (row.enrollment_status === null || row.learner_status === null) continue; // no enrolments

    course.enrolled += 1;
    const { outcome, reason } = classifyEnrollment({
      certificateStatus: row.certificate_status,
      enrollmentStatus: row.enrollment_status,
      learnerStatus: row.learner_status,
    });
    if (outcome === 'issued') course.counts.eligible += 1;
    else if (reason === 'already_issued' || reason === 'revoked') course.counts.alreadyIssued += 1;
    else if (reason === 'not_completed') course.counts.notCompleted += 1;
    else course.counts.inactive += 1; // learner_inactive
  }
  return [...byCourse.values()];
}
