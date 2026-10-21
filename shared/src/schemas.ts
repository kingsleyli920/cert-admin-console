import { z } from 'zod';

// ---- primitives -----------------------------------------------------------

export const idSchema = z.coerce.number().int().positive();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR', // 400 request failed schema validation
  'BAD_REQUEST', // 400 malformed request rejected by Fastify (e.g. invalid JSON)
  'UNAUTHORIZED', // 401
  'NOT_FOUND', // 404 (also: resource belongs to another tenant)
  'ALREADY_REVOKED', // 409
  'IDEMPOTENCY_KEY_REUSED', // 422 same key, different course
  'INTERNAL_ERROR', // 500
]);

// ---- health & error envelope ---------------------------------------------

export const healthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Every non-2xx response body. */
export const errorResponseSchema = z.object({
  error: z.object({ code: errorCodeSchema, message: z.string() }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ---- session --------------------------------------------------------------

export const adminSummarySchema = z.object({ id: z.string(), name: z.string() });
export const tenantSummarySchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
  timezone: z.string(), // IANA, e.g. Australia/Sydney
});
export const adminsResponseSchema = z.object({ items: z.array(adminSummarySchema) });
export const signInRequestSchema = z.object({ adminId: z.string().min(1) });
export const meResponseSchema = z.object({
  admin: adminSummarySchema,
  tenants: z.array(tenantSummarySchema),
});

// ---- certificates ---------------------------------------------------------

export const certificateStatusSchema = z.enum(['valid', 'revoked']);
export const certificateSortSchema = z.enum(['issuedAt', 'learnerName', 'courseTitle', 'serial']);
export const sortOrderSchema = z.enum(['asc', 'desc']);

/** Shared by the list endpoint and the CSV export (export ignores page/pageSize). */
export const certificateListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  courseId: idSchema.optional(),
  status: certificateStatusSchema.optional(),
  sort: certificateSortSchema.default('issuedAt'),
  order: sortOrderSchema.default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const certificateListItemSchema = z.object({
  id: z.number().int(),
  serial: z.string(),
  learnerId: z.number().int(),
  learnerName: z.string(),
  courseId: z.number().int(),
  courseTitle: z.string(),
  issuedAt: isoDateTimeSchema,
  status: certificateStatusSchema,
});
export const certificateListResponseSchema = z.object({
  items: z.array(certificateListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const auditActionSchema = z.enum(['ISSUE', 'REVOKE']);
export const auditEntrySchema = z.object({
  id: z.number().int(),
  action: auditActionSchema,
  actor: adminSummarySchema,
  createdAt: isoDateTimeSchema,
  certificateId: z.number().int(),
  courseId: z.number().int(),
  learnerId: z.number().int(),
  runId: z.number().int().nullable(),
});

export const certificateDetailSchema = certificateListItemSchema.extend({
  issuedBy: adminSummarySchema,
  revokedAt: isoDateTimeSchema.nullable(),
  revokedBy: adminSummarySchema.nullable(),
  revokeReason: z.string().nullable(),
  audit: z.array(auditEntrySchema), // oldest first
});
export const revokeRequestSchema = z.object({ reason: z.string().trim().min(1).max(500) });

// ---- courses & bulk issue -------------------------------------------------

export const courseCountsSchema = z.object({
  eligible: z.number().int(), // would be issued now
  alreadyIssued: z.number().int(), // valid or revoked certificate exists
  notCompleted: z.number().int(),
  inactive: z.number().int(), // completed, no certificate, learner inactive
});
export const courseSummarySchema = z.object({
  id: z.number().int(),
  title: z.string(),
  enrolled: z.number().int(),
  counts: courseCountsSchema,
});
export const coursesResponseSchema = z.object({ items: z.array(courseSummarySchema) });

export const runItemOutcomeSchema = z.enum(['pending', 'issued', 'skipped', 'failed']);
export const runItemReasonSchema = z.enum([
  'already_issued',
  'revoked',
  'not_completed',
  'learner_inactive',
  'internal_error',
]);
export const idempotencyKeySchema = z.uuid();

export const bulkIssueRunItemSchema = z.object({
  learnerId: z.number().int(),
  learnerName: z.string(),
  outcome: runItemOutcomeSchema,
  reason: runItemReasonSchema.nullable(),
  certificateId: z.number().int().nullable(),
  serial: z.string().nullable(),
});
export const bulkIssueRunSchema = z.object({
  id: z.number().int(),
  courseId: z.number().int(),
  courseTitle: z.string(),
  status: z.enum(['running', 'completed']),
  createdAt: isoDateTimeSchema,
  createdBy: adminSummarySchema,
  total: z.number().int(),
  processed: z.number().int(),
  counts: z.object({
    issued: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    pending: z.number().int(),
  }),
  items: z.array(bulkIssueRunItemSchema), // ordered by learner name, then id
});
/** POST /bulk-issue (202) and GET /bulk-issue-runs/:runId (200) both return this. */
export const bulkIssueRunResponseSchema = z.object({ run: bulkIssueRunSchema });

// ---- audit log (P2) ---------------------------------------------------------

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const auditLogResponseSchema = z.object({
  items: z.array(
    auditEntrySchema.extend({ serial: z.string(), learnerName: z.string(), courseTitle: z.string() }),
  ),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

// ---- inferred types -------------------------------------------------------

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type AdminSummary = z.infer<typeof adminSummarySchema>;
export type TenantSummary = z.infer<typeof tenantSummarySchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type CertificateListQuery = z.infer<typeof certificateListQuerySchema>;
export type CertificateListItem = z.infer<typeof certificateListItemSchema>;
export type CertificateListResponse = z.infer<typeof certificateListResponseSchema>;
export type CertificateDetail = z.infer<typeof certificateDetailSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type CourseSummary = z.infer<typeof courseSummarySchema>;
export type BulkIssueRun = z.infer<typeof bulkIssueRunSchema>;
export type BulkIssueRunItem = z.infer<typeof bulkIssueRunItemSchema>;
export type RunItemReason = z.infer<typeof runItemReasonSchema>;
