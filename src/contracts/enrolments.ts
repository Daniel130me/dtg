import { z } from "zod";

// ---------------------------------------------------------------------------
// Named constants (no magic values)
// ---------------------------------------------------------------------------

export const ENROLMENT_PAGE_LIMIT_MIN = 1;
export const ENROLMENT_PAGE_LIMIT_MAX = 24;
export const ENROLMENT_PAGE_LIMIT_DEFAULT = 12;

export const ENROLMENT_STATUSES = ["ACTIVE", "COMPLETED", "REVOKED"] as const;
export const ENROLMENT_SOURCES = ["FREE", "PURCHASE", "ADMIN"] as const;
/** Status filters accepted by the my-learning list endpoint. */
export const ENROLMENT_STATUS_FILTERS = ["ACTIVE", "COMPLETED"] as const;
/**
 * Client-safe course-level tuple: mirrors the Prisma enum without importing
 * server-only generated types into client bundles.
 */
export const COURSE_LEVELS_FOR_ENROLMENT = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

export type EnrolmentStatusValue = (typeof ENROLMENT_STATUSES)[number];
export type EnrolmentSourceValue = (typeof ENROLMENT_SOURCES)[number];
export type EnrolmentStatusFilter = (typeof ENROLMENT_STATUS_FILTERS)[number];

/**
 * Error code shared by server and client for paid courses while the launch
 * payment provider is not configured (Phase 7 payments milestone).
 */
export const PAYMENT_PROVIDER_NOT_CONFIGURED = "PAYMENT_PROVIDER_NOT_CONFIGURED";

// ---------------------------------------------------------------------------
// Query contracts
// ---------------------------------------------------------------------------

export const enrolmentListQuerySchema = z.object({
  status: z.enum(ENROLMENT_STATUS_FILTERS).optional(),
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(ENROLMENT_PAGE_LIMIT_MIN)
    .max(ENROLMENT_PAGE_LIMIT_MAX)
    .default(ENROLMENT_PAGE_LIMIT_DEFAULT),
});

export type EnrolmentListQuery = z.infer<typeof enrolmentListQuerySchema>;

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

export const enrolledCourseSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  shortDescription: z.string(),
  level: z.enum(COURSE_LEVELS_FOR_ENROLMENT),
  language: z.string(),
  thumbnailUrl: z.string().nullable(),
  totalLessons: z.number().int(),
  totalMinutes: z.number().int(),
  categoryName: z.string(),
  categorySlug: z.string(),
});

/**
 * Learner progress against the enrolled course. Null on the enrolment when it
 * no longer represents an active learning journey (REVOKED); present (possibly
 * at zero) for ACTIVE and COMPLETED enrolments.
 */
export const enrolmentProgressSchema = z.object({
  completedLessons: z.number().int().nonnegative(),
  totalLessons: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
});

export const enrolmentDtoSchema = z.object({
  id: z.uuid(),
  courseId: z.uuid(),
  status: z.enum(ENROLMENT_STATUSES),
  source: z.enum(ENROLMENT_SOURCES),
  enrolledAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  course: enrolledCourseSummarySchema,
  progress: enrolmentProgressSchema.nullable(),
});

export const paginatedEnrolmentsSchema = z.object({
  items: z.array(enrolmentDtoSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});

/** Lightweight state probe for the course detail page CTA. */
export const courseEnrolmentStateSchema = z.object({
  enrolled: z.boolean(),
  status: z.enum(ENROLMENT_STATUSES).nullable(),
});

export type EnrolledCourseSummaryDto = z.infer<typeof enrolledCourseSummarySchema>;
export type EnrolmentProgressDto = z.infer<typeof enrolmentProgressSchema>;
export type EnrolmentDto = z.infer<typeof enrolmentDtoSchema>;
export type PaginatedEnrolmentsDto = z.infer<typeof paginatedEnrolmentsSchema>;
export type CourseEnrolmentStateDto = z.infer<typeof courseEnrolmentStateSchema>;
