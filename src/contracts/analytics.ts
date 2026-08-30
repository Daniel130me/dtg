import { z } from "zod";

// ---------------------------------------------------------------------------
// Owner analytics contracts (Phase 11).
//
// Every number on the owner dashboard is defined in docs/ANALYTICS_METRICS.md;
// this module only fixes the wire shapes and the named limits. Metric changes
// must update the doc, the service, and the fixtures in the same commit.
// ---------------------------------------------------------------------------

/** Trend window: last N calendar months including the current partial one. */
export const ANALYTICS_TREND_MONTHS = 6;
/** Rows in the "top courses" table. */
export const ANALYTICS_TOP_COURSES = 6;
/** Items in the recent-activity feed. */
export const ANALYTICS_RECENT_ACTIVITY_LIMIT = 8;
/** In-process cache TTL for the dashboard read model. */
export const ANALYTICS_CACHE_TTL_MS = 60_000;

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

export const analyticsTrendPointSchema = z.object({
  /** UTC month key, "YYYY-MM". */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** Display label, e.g. "Jan 2026". */
  label: z.string(),
  enrolments: z.number().int().nonnegative(),
  newLearners: z.number().int().nonnegative(),
  revenueMinor: z.number().int().nonnegative(),
});

export type AnalyticsTrendPointDto = z.infer<typeof analyticsTrendPointSchema>;

export const analyticsCourseRowSchema = z.object({
  courseId: z.uuid(),
  title: z.string(),
  slug: z.string(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  enrolments: z.number().int().nonnegative(),
  /** Platform formula scoped to the course; null with no in-scope enrolments. */
  completionRate: z.number().int().min(0).max(100).nullable(),
  ratingAverage: z.number().min(0).max(5).nullable(),
  ratingCount: z.number().int().nonnegative(),
  revenueMinor: z.number().int().nonnegative(),
});

export type AnalyticsCourseRowDto = z.infer<typeof analyticsCourseRowSchema>;

export const analyticsActivityKindSchema = z.enum([
  "ENROLMENT",
  "REVIEW",
  "SUBMISSION",
  "CERTIFICATE",
]);

export type AnalyticsActivityKind = z.infer<typeof analyticsActivityKindSchema>;

export const analyticsActivityItemSchema = z.object({
  id: z.string(),
  kind: analyticsActivityKindSchema,
  actorName: z.string(),
  courseTitle: z.string().nullable(),
  summary: z.string(),
  occurredAt: z.iso.datetime(),
});

export type AnalyticsActivityItemDto = z.infer<typeof analyticsActivityItemSchema>;

export const ownerAnalyticsSchema = z.object({
  totals: z.object({
    learners: z.number().int().nonnegative(),
    activeCourses: z.number().int().nonnegative(),
    totalEnrolments: z.number().int().nonnegative(),
    completedEnrolments: z.number().int().nonnegative(),
    completionRate: z.number().int().min(0).max(100).nullable(),
    /** Primary currency only; see the metrics doc for the definition. */
    currency: z.string().length(3),
    grossRevenueMinor: z.number().int().nonnegative(),
    refundedMinor: z.number().int().nonnegative(),
    netRevenueMinor: z.number().int(),
    avgRating: z.number().min(0).max(5).nullable(),
    ratingCount: z.number().int().nonnegative(),
  }),
  trend: z.array(analyticsTrendPointSchema).length(ANALYTICS_TREND_MONTHS),
  courses: z.array(analyticsCourseRowSchema),
  recentActivity: z.array(analyticsActivityItemSchema),
  /** Instant the cached payload was computed. */
  generatedAt: z.iso.datetime(),
  /** Age of the payload at response time (0 for a fresh computation). */
  freshnessSeconds: z.number().int().nonnegative(),
  cached: z.boolean(),
});

export type OwnerAnalyticsDto = z.infer<typeof ownerAnalyticsSchema>;
