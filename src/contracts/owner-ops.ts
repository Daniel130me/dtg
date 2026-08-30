import { z } from "zod";

// ---------------------------------------------------------------------------
// Owner administration contracts (Phase 11): student management, user status
// operations, support inbox, audit lookup, and data exports.
// Shared client-matchable error codes live next to their queries.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Named constants (no magic values)
// ---------------------------------------------------------------------------

export const OWNER_STUDENT_PAGE_LIMIT_DEFAULT = 20;
export const OWNER_STUDENT_PAGE_LIMIT_MAX = 50;
export const OWNER_STUDENT_SEARCH_MAX = 100;

export const OWNER_CONTACT_PAGE_LIMIT_DEFAULT = 20;
export const OWNER_CONTACT_PAGE_LIMIT_MAX = 50;

export const OWNER_AUDIT_PAGE_LIMIT_DEFAULT = 30;
export const OWNER_AUDIT_PAGE_LIMIT_MAX = 100;

/** Hard cap on rows written into one export file. */
export const EXPORT_MAX_ROWS = 5_000;
/** Export files stop being downloadable after this many hours. */
export const EXPORT_TTL_HOURS = 24;
/** Owner export history page size (small: jobs are capped by TTL anyway). */
export const EXPORT_LIST_LIMIT = 20;

export const EXPORT_TYPES = ["ENROLMENTS", "STUDENTS"] as const;
export type ExportTypeValue = (typeof EXPORT_TYPES)[number];

/** Client-safe tuple mirroring the manageable slice of UserStatus. */
export const OWNER_MANAGEABLE_USER_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export type ManageableUserStatus = (typeof OWNER_MANAGEABLE_USER_STATUSES)[number];

// Client-matchable error codes shared by server and client.
export const OWNER_USER_NOT_FOUND = "OWNER_USER_NOT_FOUND";
export const OWNER_USER_STATUS_FORBIDDEN = "OWNER_USER_STATUS_FORBIDDEN";
export const EXPORT_NOT_FOUND = "EXPORT_NOT_FOUND";
export const EXPORT_EXPIRED = "EXPORT_EXPIRED";
export const EXPORT_NOT_READY = "EXPORT_NOT_READY";

// ---------------------------------------------------------------------------
// Student management
// ---------------------------------------------------------------------------

export const ownerStudentListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(OWNER_STUDENT_PAGE_LIMIT_MAX)
    .default(OWNER_STUDENT_PAGE_LIMIT_DEFAULT),
  /** Case-insensitive contains over name or email; trimmed. */
  q: z.string().trim().max(OWNER_STUDENT_SEARCH_MAX).optional(),
  status: z.enum(OWNER_MANAGEABLE_USER_STATUSES).optional(),
});

export type OwnerStudentListQuery = z.infer<typeof ownerStudentListQuerySchema>;

export const ownerStudentRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]),
  createdAt: z.iso.datetime(),
  enrolmentCount: z.number().int().nonnegative(),
  /** max(LessonProgress.completedAt); null = no completion activity yet. */
  lastActivityAt: z.iso.datetime().nullable(),
});

export type OwnerStudentRowDto = z.infer<typeof ownerStudentRowSchema>;

export const paginatedOwnerStudentsSchema = z.object({
  items: z.array(ownerStudentRowSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

export type PaginatedOwnerStudentsDto = z.infer<typeof paginatedOwnerStudentsSchema>;

export const ownerStudentEnrolmentRowSchema = z.object({
  enrolmentId: z.uuid(),
  courseId: z.uuid(),
  courseTitle: z.string(),
  courseSlug: z.string(),
  status: z.enum(["ACTIVE", "COMPLETED", "REVOKED"]),
  source: z.enum(["FREE", "PURCHASE", "ADMIN"]),
  totalLessons: z.number().int().nonnegative(),
  completedLessons: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
  enrolledAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  lastActivityAt: z.iso.datetime().nullable(),
});

export type OwnerStudentEnrolmentRowDto = z.infer<typeof ownerStudentEnrolmentRowSchema>;

export const ownerStudentDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]),
  role: z.enum(["STUDENT", "OWNER"]),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime().nullable(),
  certificates: z.number().int().nonnegative(),
  enrolments: z.array(ownerStudentEnrolmentRowSchema),
});

export type OwnerStudentDetailDto = z.infer<typeof ownerStudentDetailSchema>;

export const ownerUserStatusSchema = z.object({
  status: z.enum(OWNER_MANAGEABLE_USER_STATUSES),
});

export type OwnerUserStatusBody = z.infer<typeof ownerUserStatusSchema>;

export const ownerUserStatusResultSchema = z.object({
  id: z.uuid(),
  status: z.enum(OWNER_MANAGEABLE_USER_STATUSES),
  sessionsRevoked: z.number().int().nonnegative(),
});

export type OwnerUserStatusResult = z.infer<typeof ownerUserStatusResultSchema>;

// ---------------------------------------------------------------------------
// Support inbox (contact submissions)
// ---------------------------------------------------------------------------

export const CONTACT_STATUSES = ["NEW", "ARCHIVED"] as const;
export type ContactStatusValue = (typeof CONTACT_STATUSES)[number];

export const ownerContactListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(OWNER_CONTACT_PAGE_LIMIT_MAX)
    .default(OWNER_CONTACT_PAGE_LIMIT_DEFAULT),
  status: z.enum(CONTACT_STATUSES).optional(),
});

export type OwnerContactListQuery = z.infer<typeof ownerContactListQuerySchema>;

export const ownerContactRowSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  subject: z.string().nullable(),
  message: z.string().nullable(),
  status: z.enum(CONTACT_STATUSES),
  createdAt: z.iso.datetime(),
});

export type OwnerContactRowDto = z.infer<typeof ownerContactRowSchema>;

export const paginatedOwnerContactsSchema = z.object({
  items: z.array(ownerContactRowSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

export type PaginatedOwnerContactsDto = z.infer<typeof paginatedOwnerContactsSchema>;

export const ownerContactStatusSchema = z.object({
  status: z.enum(CONTACT_STATUSES),
});

export type OwnerContactStatusBody = z.infer<typeof ownerContactStatusSchema>;

// ---------------------------------------------------------------------------
// Audit lookup
// ---------------------------------------------------------------------------

export const ownerAuditQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(OWNER_AUDIT_PAGE_LIMIT_MAX)
    .default(OWNER_AUDIT_PAGE_LIMIT_DEFAULT),
  actorId: z.uuid().optional(),
  action: z.string().trim().max(100).optional(),
});

export type OwnerAuditQuery = z.infer<typeof ownerAuditQuerySchema>;

export const ownerAuditRowSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
});

export type OwnerAuditRowDto = z.infer<typeof ownerAuditRowSchema>;

export const paginatedOwnerAuditSchema = z.object({
  items: z.array(ownerAuditRowSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

export type PaginatedOwnerAuditDto = z.infer<typeof paginatedOwnerAuditSchema>;

// ---------------------------------------------------------------------------
// Data exports
// ---------------------------------------------------------------------------

export const exportCreateSchema = z.object({
  type: z.enum(EXPORT_TYPES),
});

export type ExportCreateBody = z.infer<typeof exportCreateSchema>;

export const exportJobSchema = z.object({
  id: z.uuid(),
  type: z.enum(EXPORT_TYPES),
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED"]),
  rowCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  downloadCount: z.number().int().nonnegative(),
  downloadedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type ExportJobDto = z.infer<typeof exportJobSchema>;

/** Owner export history, newest first. Never carries file content. */
export const exportJobListSchema = z.object({
  items: z.array(exportJobSchema),
});

export type ExportJobListDto = z.infer<typeof exportJobListSchema>;
