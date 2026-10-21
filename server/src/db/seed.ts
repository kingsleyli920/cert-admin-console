import type { DatabaseSync } from 'node:sqlite';
import { tenantLocalYear } from '@cac/shared';

// Fixed ids that tests can rely on. Everything else is derived deterministically.
export const SEED_IDS = {
  tenants: { hht: 1, sra: 2, lcl: 3, nhi: 4 },
  admins: { alice: 'alice', bob: 'bob' },
  courses: {
    fireSafety2026: 101,
    manualHandling: 102,
    infectionControl: 103,
    privacyConfidentiality: 104,
    sraFoodSafetyBasics: 201,
    sraWorkingAtHeights: 202,
    sraFirstAidRefresher: 203,
    lclFirst: 301,
    lclLast: 320,
    nhiMentalHealthFirstAid: 401,
    nhiWorkplaceErgonomics: 402,
  },
  learners: {
    emmaWilsonHht: 1001,
    emmaWilsonSra: 2001,
    lclFirst: 3001,
    lclLast: 3400,
    nhiFirst: 4001,
    fireSafety: {
      valid: [1001, 1002],
      revoked: 1011,
      completedNoCert: [1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010],
      enrolledNotCompleted: [1012, 1013, 1014, 1015],
      completedInactive: 1016,
    },
  },
  certificates: {
    hhtDstEdge: 45,
    sraDstEdge: 115,
    lclFirst: 1001,
    lclLast: 9000,
    fireSafetyValid: [1, 2],
    fireSafetyRevoked: 3,
    hhtRevoked: [3, 11, 34],
    sraRevoked: [103, 110],
  },
} as const;

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function utcMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function emailFor(name: string, domain: string): string {
  const parts = name.toLowerCase().split(' ');
  const clean = (s: string): string => s.replace(/[^a-z]/g, '');
  return `${clean(parts[0])}.${clean(parts.slice(1).join(''))}@${domain}`;
}

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

type LearnerStatus = 'active' | 'inactive';

interface TenantRow {
  id: number;
  code: string;
  name: string;
  timezone: string;
}

interface CourseRow {
  id: number;
  tenantId: number;
  title: string;
}

interface LearnerRow {
  id: number;
  tenantId: number;
  name: string;
  email: string;
  status: LearnerStatus;
}

interface EnrollmentRow {
  id: number;
  tenantId: number;
  courseId: number;
  learnerId: number;
  completedAt: string | null;
}

interface CertificateRow {
  id: number;
  tenantId: number;
  courseId: number;
  learnerId: number;
  issuedAt: string;
  issuedBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

interface Plan {
  courses: CourseRow[];
  learners: LearnerRow[];
  enrollments: EnrollmentRow[];
  certificates: CertificateRow[];
}

// ---------------------------------------------------------------------------
// Static reference data
// ---------------------------------------------------------------------------

const TENANTS: TenantRow[] = [
  { id: 1, code: 'HHT', name: 'Harbour Health Training', timezone: 'Australia/Sydney' },
  { id: 2, code: 'SRA', name: 'Swan River Academy', timezone: 'Australia/Perth' },
  { id: 3, code: 'LCL', name: 'Large Corp Learning', timezone: 'Australia/Sydney' },
  { id: 4, code: 'NHI', name: 'New Horizons Institute', timezone: 'Australia/Brisbane' },
];

const ADMINS: Array<{ id: string; name: string }> = [
  { id: 'alice', name: 'Alice Nguyen' },
  { id: 'bob', name: 'Bob Fraser' },
];

// [admin_id, tenant_id]
const ADMIN_TENANTS: Array<[string, number]> = [
  ['alice', 1],
  ['alice', 2],
  ['bob', 3],
  ['alice', 4],
];

const HHT_LEARNERS: Array<[number, string, LearnerStatus]> = [
  [1001, 'Emma Wilson', 'active'],
  [1002, 'Jack Thompson', 'active'],
  [1003, 'Olivia Carter', 'active'],
  [1004, "Liam O'Connor", 'active'],
  [1005, 'Ruby Hayes', 'active'],
  [1006, 'Ethan Doyle', 'active'],
  [1007, 'Mia Robertson', 'active'],
  [1008, 'Noah Campbell', 'active'],
  [1009, 'Isabella Grant', 'active'],
  [1010, 'Lucas Fletcher', 'active'],
  [1011, 'Harrison Walsh', 'active'],
  [1012, 'Amelia Scott', 'active'],
  [1013, 'Oliver Ward', 'active'],
  [1014, 'Chloe Price', 'active'],
  [1015, 'James Nolan', 'active'],
  [1016, 'Thomas Reid', 'inactive'],
  [1017, 'Sophie Turner', 'active'],
  [1018, 'Kai Nakamura', 'active'],
  [1019, 'Grace Lim', 'active'],
  [1020, 'Ben Harris', 'active'],
  [1021, 'Zoe Mitchell', 'active'],
  [1022, 'Daniel Park', 'active'],
];

const SRA_LEARNERS: Array<[number, string]> = [
  [2001, 'Emma Wilson'],
  [2002, 'Liam Patel'],
  [2003, 'Sofia Rossi'],
  [2004, 'Noah Kim'],
  [2005, 'Chloe Martin'],
  [2006, 'Ethan Brown'],
  [2007, 'Ava Singh'],
  [2008, 'Mia Walker'],
];

const NHI_LEARNERS: Array<[number, string]> = [
  [4001, 'Hugo Bell'],
  [4002, 'Isla Brooks'],
  [4003, 'Ravi Mehta'],
  [4004, 'Ella Gray'],
  [4005, 'Jun Park'],
  [4006, 'Maya Lopez'],
];

const LCL_FIRST_NAMES = [
  'Olivia', 'Liam', 'Charlotte', 'Noah', 'Amelia', 'Jack', 'Isla', 'William', 'Grace', 'Lucas',
  'Hannah', 'Henry', 'Zara', 'Oscar', 'Priya', 'Mason', 'Lily', 'Samuel', 'Aisha', 'Leo',
];

const LCL_LAST_NAMES = [
  'Smith', 'Chen', 'Patel', 'Murphy', "O'Brien", 'Kim', 'Taylor', 'Singh', 'Lee', 'Walker',
  'Hughes', 'Nakamura', 'Costa', 'Morgan', 'Ahmed', 'Reid', 'Stewart', 'Ivanova', 'Bennett', 'Fraser',
];

const LCL_COURSE_TITLES = [
  'Cyber Security Awareness', 'Data Privacy Essentials', 'Anti-Money Laundering', 'Code of Conduct',
  'Workplace Harassment Prevention', 'Diversity and Inclusion', 'Financial Crime Basics',
  'Sustainability Foundations', 'Customer Complaints Handling', 'Record Management',
  'Information Security Policy', 'Phishing Response', 'Safe Lifting Practices', 'Fraud Detection',
  'Equal Opportunity', 'Ethics in Procurement', 'Travel and Expense Policy', 'Remote Work Safety',
  'Incident Reporting', 'Leadership Foundations',
];

const LCL_REVOKE_REASONS = [
  'Assessment record audited and invalidated',
  'Learner identity could not be verified',
  'Course content superseded',
  'Issued in error by administrator',
];

// ---------------------------------------------------------------------------
// Plan construction (pure, deterministic)
// ---------------------------------------------------------------------------

function buildPlan(): Plan {
  const courses: CourseRow[] = [];
  const learners: LearnerRow[] = [];
  const enrollments: EnrollmentRow[] = [];
  const certificates: CertificateRow[] = [];

  const addCourse = (id: number, tenantId: number, title: string): void => {
    courses.push({ id, tenantId, title });
  };
  const addLearner = (id: number, tenantId: number, name: string, status: LearnerStatus, domain: string): void => {
    learners.push({ id, tenantId, name, email: emailFor(name, domain), status });
  };
  const addEnrollment = (tenantId: number, courseId: number, learnerId: number, completedAt: string | null): void => {
    enrollments.push({ id: enrollments.length + 1, tenantId, courseId, learnerId, completedAt });
  };

  // ----- HHT (tenant 1) -----------------------------------------------------
  addCourse(101, 1, 'Fire Safety 2026');
  addCourse(102, 1, 'Manual Handling');
  addCourse(103, 1, 'Infection Control');
  addCourse(104, 1, 'Privacy & Confidentiality');
  for (const [id, name, status] of HHT_LEARNERS) addLearner(id, 1, name, status, 'hht.example');

  // Fire Safety 2026: exactly 16 enrollments.
  const FIRE = SEED_IDS.courses.fireSafety2026;
  const fs = SEED_IDS.learners.fireSafety;
  // 2 valid certificates (Emma Wilson is one of them).
  addEnrollment(1, FIRE, fs.valid[0], iso(utcMs(2026, 2, 9, 9, 0)));
  addEnrollment(1, FIRE, fs.valid[1], iso(utcMs(2026, 2, 10, 10, 0)));
  // 1 revoked certificate.
  addEnrollment(1, FIRE, fs.revoked, iso(utcMs(2026, 2, 11, 8, 0)));
  // 8 completed, active, no certificate -> should be issuable.
  for (const id of fs.completedNoCert) {
    addEnrollment(1, FIRE, id, iso(utcMs(2026, 2, id - 1000, 10, 0)));
  }
  // 4 enrolled but not completed.
  for (const id of fs.enrolledNotCompleted) addEnrollment(1, FIRE, id, null);
  // 1 completed but learner inactive, no certificate.
  addEnrollment(1, FIRE, fs.completedInactive, iso(utcMs(2026, 2, 4, 10, 0)));

  certificates.push({
    id: SEED_IDS.certificates.fireSafetyValid[0],
    tenantId: 1,
    courseId: FIRE,
    learnerId: fs.valid[0],
    issuedAt: iso(utcMs(2026, 2, 18, 9, 30)),
    issuedBy: 'alice',
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  });
  certificates.push({
    id: SEED_IDS.certificates.fireSafetyValid[1],
    tenantId: 1,
    courseId: FIRE,
    learnerId: fs.valid[1],
    issuedAt: iso(utcMs(2026, 2, 19, 11, 0)),
    issuedBy: 'alice',
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  });
  certificates.push({
    id: SEED_IDS.certificates.fireSafetyRevoked,
    tenantId: 1,
    courseId: FIRE,
    learnerId: fs.revoked,
    issuedAt: iso(utcMs(2026, 2, 20, 8, 45)),
    issuedBy: 'alice',
    revokedAt: iso(utcMs(2026, 3, 5, 14, 0)),
    revokedBy: 'alice',
    revokeReason: 'Issued against superseded course version',
  });

  // Manual Handling, Infection Control, Privacy & Confidentiality:
  // 14 completed certificates each (42 total), cert ids 4..45.
  // Learner pool = active HHT learners; each course uses a sliding window.
  const hhtPool = HHT_LEARNERS.filter(([, , status]) => status === 'active').map(([id]) => id);
  const HHT_OTHER_COURSES = [102, 103, 104];
  const HHT_OTHER_REVOKES = new Map<number, string>([
    [7, 'Learner did not meet assessment standard'],
    [30, 'Duplicate enrolment processed twice'],
  ]);
  for (let k = 0; k < HHT_OTHER_COURSES.length; k++) {
    const courseId = HHT_OTHER_COURSES[k];
    for (let t = 0; t < 14; t++) {
      const idx = k * 14 + t;
      const learnerId = hhtPool[(k * 5 + t) % hhtPool.length];
      let issuedMs = utcMs(2025, 2, 3, 8, 0) + idx * 13 * DAY + (idx % 5) * 3 * HOUR;
      let completedMs = issuedMs - (4 + (idx % 4)) * DAY;
      if (idx === 41) {
        // The DST-edge certificate: 2026-04-04T14:30:00Z (5 Apr 2026 in Sydney).
        issuedMs = utcMs(2026, 4, 4, 14, 30);
        completedMs = utcMs(2026, 3, 27, 10, 0);
      }
      const revokeReason = HHT_OTHER_REVOKES.get(idx);
      addEnrollment(1, courseId, learnerId, iso(completedMs));
      certificates.push({
        id: 4 + idx,
        tenantId: 1,
        courseId,
        learnerId,
        issuedAt: iso(issuedMs),
        issuedBy: 'alice',
        revokedAt: revokeReason !== undefined ? iso(issuedMs + 45 * DAY) : null,
        revokedBy: revokeReason !== undefined ? 'alice' : null,
        revokeReason: revokeReason ?? null,
      });
    }
  }
  // Two extra non-completed enrollments in Manual Handling (no certificate).
  addEnrollment(1, 102, 1019, null);
  addEnrollment(1, 102, 1020, null);

  // ----- SRA (tenant 2) -----------------------------------------------------
  addCourse(201, 2, 'Food Safety Basics');
  addCourse(202, 2, 'Working at Heights');
  addCourse(203, 2, 'First Aid Refresher');
  for (const [id, name] of SRA_LEARNERS) addLearner(id, 2, name, 'active', 'sra.example');

  const SRA_COURSE_LEARNERS: Array<[number, number[]]> = [
    [201, [2001, 2002, 2003, 2004, 2005]],
    [202, [2003, 2004, 2005, 2006, 2007]],
    [203, [2002, 2004, 2006, 2008, 2001]],
  ];
  const SRA_REVOKES = new Map<number, string>([
    [2, 'Assessment record incomplete'],
    [9, 'Certificate issued to wrong learner'],
  ]);
  for (let k = 0; k < SRA_COURSE_LEARNERS.length; k++) {
    const [courseId, learnerIds] = SRA_COURSE_LEARNERS[k];
    for (let t = 0; t < learnerIds.length; t++) {
      const idx = k * 5 + t;
      const learnerId = learnerIds[t];
      let issuedMs = utcMs(2025, 5, 1, 9, 0) + idx * 30 * DAY + (idx % 3) * 2 * HOUR;
      let completedMs = issuedMs - 5 * DAY;
      if (idx === 14) {
        // The DST-edge certificate: 2026-04-04T14:30:00Z (4 Apr 2026 in Perth).
        issuedMs = utcMs(2026, 4, 4, 14, 30);
        completedMs = utcMs(2026, 3, 30, 9, 0);
      }
      const revokeReason = SRA_REVOKES.get(idx);
      addEnrollment(2, courseId, learnerId, iso(completedMs));
      certificates.push({
        id: 101 + idx,
        tenantId: 2,
        courseId,
        learnerId,
        issuedAt: iso(issuedMs),
        issuedBy: 'alice',
        revokedAt: revokeReason !== undefined ? iso(issuedMs + 20 * DAY) : null,
        revokedBy: revokeReason !== undefined ? 'alice' : null,
        revokeReason: revokeReason ?? null,
      });
    }
  }
  // Three non-completed enrollments in Food Safety Basics (no certificate).
  addEnrollment(2, 201, 2006, null);
  addEnrollment(2, 201, 2007, null);
  addEnrollment(2, 201, 2008, null);

  // ----- LCL (tenant 3): 400 learners x 20 courses, all completed, all certified
  addCourse(301, 3, LCL_COURSE_TITLES[0]);
  for (let j = 1; j < 20; j++) addCourse(301 + j, 3, LCL_COURSE_TITLES[j]);
  for (let i = 0; i < 400; i++) {
    const name = `${LCL_FIRST_NAMES[i % 20]} ${LCL_LAST_NAMES[Math.floor(i / 20)]}`;
    addLearner(3001 + i, 3, name, 'active', 'lcl.example');
  }
  const rng = mulberry32(20260101);
  const LCL_START = utcMs(2025, 1, 1, 0, 0);
  const LCL_MINUTES = (utcMs(2026, 9, 30, 23, 59) - LCL_START) / MINUTE;
  const LCL_REVOKE_CAP = utcMs(2026, 10, 15, 0, 0);
  for (let i = 0; i < 400; i++) {
    const learnerId = 3001 + i;
    for (let j = 0; j < 20; j++) {
      const n = i * 20 + j;
      const courseId = 301 + j;
      const issuedMs = LCL_START + Math.floor(rng() * LCL_MINUTES) * MINUTE;
      const completedMs = issuedMs - (2 + Math.floor(rng() * 60)) * DAY;
      const revokeGapMs = (5 + Math.floor(rng() * 60)) * DAY;
      // Exactly 80 of 8000 (1%): n*37 + 17 == 0 (mod 100) has one solution per 100 consecutive n.
      const revoked = (n * 37 + 17) % 100 === 0;
      addEnrollment(3, courseId, learnerId, iso(completedMs));
      certificates.push({
        id: 1001 + n,
        tenantId: 3,
        courseId,
        learnerId,
        issuedAt: iso(issuedMs),
        issuedBy: 'bob',
        revokedAt: revoked ? iso(Math.min(issuedMs + revokeGapMs, LCL_REVOKE_CAP)) : null,
        revokedBy: revoked ? 'bob' : null,
        revokeReason: revoked ? LCL_REVOKE_REASONS[n % LCL_REVOKE_REASONS.length] : null,
      });
    }
  }

  // ----- NHI (tenant 4): 2 courses, ~10 enrollments, zero certificates -------
  addCourse(401, 4, 'Mental Health First Aid');
  addCourse(402, 4, 'Workplace Ergonomics');
  for (const [id, name] of NHI_LEARNERS) addLearner(id, 4, name, 'active', 'nhi.example');
  addEnrollment(4, 401, 4001, iso(utcMs(2026, 1, 15, 10, 0)));
  addEnrollment(4, 401, 4002, iso(utcMs(2026, 1, 16, 10, 0)));
  addEnrollment(4, 401, 4003, iso(utcMs(2026, 1, 20, 10, 0)));
  addEnrollment(4, 401, 4004, null);
  addEnrollment(4, 401, 4005, null);
  addEnrollment(4, 402, 4002, iso(utcMs(2026, 2, 3, 9, 0)));
  addEnrollment(4, 402, 4003, null);
  addEnrollment(4, 402, 4004, iso(utcMs(2026, 2, 5, 9, 0)));
  addEnrollment(4, 402, 4005, null);
  addEnrollment(4, 402, 4006, iso(utcMs(2026, 2, 9, 9, 0)));

  return { courses, learners, enrollments, certificates };
}

// ---------------------------------------------------------------------------
// Serial assignment: {CODE}-{tenant-local YYYY}-{per-tenant sequence}
// ---------------------------------------------------------------------------

function byIssuedThenId(a: CertificateRow, b: CertificateRow): number {
  if (a.issuedAt !== b.issuedAt) return a.issuedAt < b.issuedAt ? -1 : 1;
  return a.id - b.id;
}

function assignSerials(certificates: CertificateRow[]): Map<number, string> {
  const serials = new Map<number, string>();
  for (const tenant of TENANTS) {
    const mine = certificates.filter((c) => c.tenantId === tenant.id).sort(byIssuedThenId);
    mine.forEach((c, idx) => {
      const year = tenantLocalYear(c.issuedAt, tenant.timezone);
      serials.set(c.id, `${tenant.code}-${year}-${String(idx + 1).padStart(6, '0')}`);
    });
  }
  return serials;
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

function insertPlan(db: DatabaseSync, plan: Plan): void {
  const insTenant = db.prepare(
    'INSERT INTO tenants (id, code, name, timezone, next_serial) VALUES (?, ?, ?, ?, 1)',
  );
  const insAdmin = db.prepare('INSERT INTO admins (id, name) VALUES (?, ?)');
  const insAdminTenant = db.prepare('INSERT INTO admin_tenants (admin_id, tenant_id) VALUES (?, ?)');
  const insCourse = db.prepare('INSERT INTO courses (id, tenant_id, title) VALUES (?, ?, ?)');
  const insLearner = db.prepare(
    'INSERT INTO learners (id, tenant_id, name, email, status) VALUES (?, ?, ?, ?, ?)',
  );
  const insEnrollment = db.prepare(
    'INSERT INTO enrollments (id, tenant_id, course_id, learner_id, status, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insCertificate = db.prepare(
    'INSERT INTO certificates (id, tenant_id, course_id, learner_id, serial, issued_at, issued_by, status, revoked_at, revoked_by, revoke_reason) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insAudit = db.prepare(
    'INSERT INTO audit_logs (tenant_id, actor_id, action, certificate_id, course_id, learner_id, run_id, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
  );
  const setNextSerial = db.prepare('UPDATE tenants SET next_serial = ? WHERE id = ?');

  for (const t of TENANTS) insTenant.run(t.id, t.code, t.name, t.timezone);
  for (const a of ADMINS) insAdmin.run(a.id, a.name);
  for (const [adminId, tenantId] of ADMIN_TENANTS) insAdminTenant.run(adminId, tenantId);

  for (const c of plan.courses) insCourse.run(c.id, c.tenantId, c.title);

  const emailSeen = new Set<string>();
  for (const l of plan.learners) {
    const key = `${l.tenantId}|${l.email}`;
    if (emailSeen.has(key)) throw new Error(`duplicate learner email within tenant: ${key}`);
    emailSeen.add(key);
    insLearner.run(l.id, l.tenantId, l.name, l.email, l.status);
  }

  for (const e of plan.enrollments) {
    insEnrollment.run(e.id, e.tenantId, e.courseId, e.learnerId, e.completedAt === null ? 'enrolled' : 'completed', e.completedAt);
  }

  const serials = assignSerials(plan.certificates);
  const certs = [...plan.certificates].sort((a, b) => a.id - b.id);
  for (const c of certs) {
    const serial = serials.get(c.id);
    if (serial === undefined) throw new Error(`no serial for certificate ${c.id}`);
    insCertificate.run(
      c.id,
      c.tenantId,
      c.courseId,
      c.learnerId,
      serial,
      c.issuedAt,
      c.issuedBy,
      c.revokedAt === null ? 'valid' : 'revoked',
      c.revokedAt,
      c.revokedBy,
      c.revokeReason,
    );
  }

  for (const c of certs) {
    insAudit.run(c.tenantId, c.issuedBy, 'ISSUE', c.id, c.courseId, c.learnerId, c.issuedAt);
    if (c.revokedAt !== null && c.revokedBy !== null) {
      insAudit.run(c.tenantId, c.revokedBy, 'REVOKE', c.id, c.courseId, c.learnerId, c.revokedAt);
    }
  }

  const certCountByTenant = new Map<number, number>();
  for (const c of certs) certCountByTenant.set(c.tenantId, (certCountByTenant.get(c.tenantId) ?? 0) + 1);
  for (const t of TENANTS) setNextSerial.run((certCountByTenant.get(t.id) ?? 0) + 1, t.id);
}

/**
 * Inserts the full seed data set. The caller owns the transaction (see `resetDatabase`).
 * Assumes schema.sql has been executed and the tables are empty.
 */
export function seedRows(db: DatabaseSync): void {
  insertPlan(db, buildPlan());
}

/**
 * Inserts the full seed data set in one transaction.
 * Assumes schema.sql has been executed and the tables are empty.
 */
export function seed(db: DatabaseSync): void {
  const plan = buildPlan();
  db.exec('BEGIN');
  try {
    insertPlan(db, plan);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
