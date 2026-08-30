import { CourseStatus, EnrolmentStatus, PaymentStatus, RefundStatus, ReviewStatus, UserRole } from "@prisma/client";
import type {
  AnalyticsCourseRowDto,
  OwnerAnalyticsDto,
} from "@/contracts/analytics";
import {
  ANALYTICS_CACHE_TTL_MS,
  ANALYTICS_RECENT_ACTIVITY_LIMIT,
  ANALYTICS_TOP_COURSES,
  ANALYTICS_TREND_MONTHS,
} from "@/contracts/analytics";
import { db } from "@/server/db/client";
import {
  type ActivityCandidate,
  buildMonthBuckets,
  buildTrendPoints,
  computeCompletionRate,
  enrolmentRollupByCourse,
  mergeRecentActivity,
  pickPrimaryCurrency,
  rankTopCourses,
  revenueMinorByCourse,
  sumRevenue,
  tallyPerBucket,
} from "@/server/modules/analytics/analytics.logic";
// The denormalized Course rating fields are owned transactionally by the
// reviews module; reusing its null-safe rounding keeps analytics byte-identical
// with the catalog's aggregate semantics (docs/ANALYTICS_METRICS.md).
import { roundRatingAverage } from "@/server/modules/reviews/reviews.logic";

/**
 * Owner analytics read model (docs/ANALYTICS_METRICS.md is the definition of
 * record for every number below).
 *
 * Authorization model: the route resolves the caller through
 * requireOwner(headers) — session, OWNER role, and the platform-ownership
 * check — before this service runs. The service itself trusts the caller:
 * every metric is platform-wide, so there is no narrower row scope to pin.
 *
 * Query budget: 12 reads in 2 sequential rounds, all indexed or bounded:
 *   1. all-time non-REVOKED enrolment rows — one read feeds the headline
 *      totals, the monthly trend buckets (sliced in JS) AND the per-course
 *      rollup; the doc defines the totals over exactly these rows, so no
 *      second groupBy read exists to drift ((status, createdAt) index,
 *      bounded by platform scale);
 *   2. learner count;
 *   3. new-learner trend rows (window-bounded);
 *   4. published-course count;
 *   5. VISIBLE-only review aggregate;
 *   6. all-time SUCCEEDED payment rows (order items included for per-course
 *      revenue attribution);
 *   7. all-time SUCCEEDED refund rows;
 *   8. course rows for exactly the ranked top courses;
 *   9-12. recent activity: latest enrolments / VISIBLE reviews / assignment
 *      submissions / certificates, each a bounded take.
 *
 * Freshness (doc): the assembled payload is cached in process memory for
 * ANALYTICS_CACHE_TTL_MS; a hit returns the frozen numbers with a recomputed
 * freshnessSeconds and cached=true. No aggregation tables or background jobs
 * exist — the truth rows are small enough at launch scale, and a materialized
 * view would be the first thing to drift.
 */

interface AnalyticsCache {
  payload: OwnerAnalyticsDto;
  /** Epoch ms of the computation — identical to Date.parse(payload.generatedAt). */
  computedAtMs: number;
}

// Module-level single-entry cache: the owner dashboard is a single-actor
// surface, so one payload per process covers every consumer of the endpoint.
let analyticsCache: AnalyticsCache | null = null;

const MS_PER_SECOND = 1_000;

export async function getOwnerAnalytics(): Promise<OwnerAnalyticsDto> {
  const nowMs = Date.now();
  if (analyticsCache && nowMs - analyticsCache.computedAtMs < ANALYTICS_CACHE_TTL_MS) {
    // Cache hit: the numbers stay frozen for the TTL; only the freshness
    // stamp is recomputed so the client can render "updated Ns ago" honestly.
    return {
      ...analyticsCache.payload,
      freshnessSeconds: Math.floor((nowMs - analyticsCache.computedAtMs) / MS_PER_SECOND),
      cached: true,
    };
  }
  const payload = await computeOwnerAnalytics();
  analyticsCache = { payload, computedAtMs: nowMs };
  return { ...payload, freshnessSeconds: 0, cached: false };
}

/**
 * Bounded per-source takes for the activity feed. The enrolment read (the
 * densest source) takes the full feed limit; the other three sources take a
 * bounded slice each — the merge re-caps to ANALYTICS_RECENT_ACTIVITY_LIMIT
 * regardless, so the feed shape never depends on which sources are busiest.
 */
const ACTIVITY_SOURCE_TAKE = 4;

async function computeOwnerAnalytics(): Promise<OwnerAnalyticsDto> {
  const computedAt = new Date();
  const buckets = buildMonthBuckets(computedAt, ANALYTICS_TREND_MONTHS);
  const windowStart = buckets[0].startUtc;

  const [
    enrolmentRows,
    learnerCount,
    newLearnerRows,
    activeCourseCount,
    reviewStats,
    paymentRows,
    refundRows,
  ] = await Promise.all([
    // (1) ALL-TIME non-REVOKED enrolments. Trend bucketing happens in JS (the
    // pure logic drops pre-window rows); REVOKED access is removed from every
    // headline metric per the doc.
    db.enrolment.findMany({
      where: { status: { not: EnrolmentStatus.REVOKED } },
      select: { courseId: true, status: true, createdAt: true },
    }),
    // (2) Suspended learners still exist and still count (doc).
    db.user.count({ where: { role: UserRole.STUDENT, deletedAt: null } }),
    // (3) New-learner trend rows, bounded by the trend window.
    db.user.findMany({
      where: { role: UserRole.STUDENT, deletedAt: null, createdAt: { gte: windowStart } },
      select: { createdAt: true },
    }),
    // (4) Drafts and archived courses are not "active".
    db.course.count({ where: { status: CourseStatus.PUBLISHED } }),
    // (5) Platform-wide, VISIBLE-only rating aggregate (mirrors the catalog).
    db.review.aggregate({
      where: { status: ReviewStatus.VISIBLE },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    // (6) All-time SUCCEEDED payments; the trend is cut in JS from
    // Payment.updatedAt, which for SUCCEEDED rows is the instant they
    // succeeded (doc "Payment success time"). When a refund settles,
    // refunds.service flips the payment SUCCEEDED -> REFUNDED, so that
    // payment leaves gross exactly when its refund row starts subtracting;
    // net is never negative-clamped (doc).
    db.payment.findMany({
      where: { status: PaymentStatus.SUCCEEDED },
      select: {
        amountMinor: true,
        currency: true,
        updatedAt: true,
        order: { select: { items: { select: { courseId: true } } } },
      },
    }),
    // (7) All-time SUCCEEDED refunds; rows carry the payment's currency, so
    // the primary-currency filter applies to them directly.
    db.refund.findMany({
      where: { status: RefundStatus.SUCCEEDED },
      select: { amountMinor: true, currency: true },
    }),
  ]);

  // Only the primary currency contributes to headline/revenue/course numbers
  // (doc: no conversion rates are invented).
  const primaryCurrency = pickPrimaryCurrency(paymentRows);
  const revenue = sumRevenue(paymentRows, refundRows, primaryCurrency);

  const totalEnrolments = enrolmentRows.length;
  const completedEnrolments = enrolmentRows.filter(
    (row) => row.status === EnrolmentStatus.COMPLETED,
  ).length;

  const enrolmentTally = tallyPerBucket(enrolmentRows, (row) => row.createdAt, buckets, () => 1);
  const learnerTally = tallyPerBucket(newLearnerRows, (row) => row.createdAt, buckets, () => 1);
  const revenueTally = tallyPerBucket(
    paymentRows.filter((row) => row.currency === primaryCurrency),
    (row) => row.updatedAt,
    buckets,
    (row) => row.amountMinor,
  );

  // Per-course rollup + ranking from the same all-time enrolment rows.
  const rollups = enrolmentRollupByCourse(enrolmentRows);
  const topCourses = rankTopCourses(enrolmentRows, ANALYTICS_TOP_COURSES);
  const revenueByCourse = revenueMinorByCourse(
    paymentRows.map((row) => ({
      amountMinor: row.amountMinor,
      currency: row.currency,
      // Distinct courses per payment: a duplicated item line counts once.
      courseIds: [...new Set(row.order.items.map((item) => item.courseId))],
    })),
    primaryCurrency,
  );

  const [courseRows, latestEnrolments, latestReviews, latestSubmissions, latestCertificates] =
    await Promise.all([
      // (8) Card fields for exactly the ranked courses. Computed from the
      // live Enrolment rows, never the denormalized Course.enrollmentCount
      // display cache (doc "Course rows").
      db.course.findMany({
        where: { id: { in: topCourses.map((rank) => rank.courseId) } },
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          ratingAverage: true,
          ratingCount: true,
        },
      }),
      // (9-12) Recent activity — informational feed, every dashboard number
      // still comes from the formulas above (doc).
      db.enrolment.findMany({
        orderBy: { createdAt: "desc" },
        take: ANALYTICS_RECENT_ACTIVITY_LIMIT,
        select: {
          id: true,
          createdAt: true,
          user: { select: { name: true } },
          course: { select: { title: true } },
        },
      }),
      db.review.findMany({
        where: { status: ReviewStatus.VISIBLE },
        orderBy: { createdAt: "desc" },
        take: ACTIVITY_SOURCE_TAKE,
        select: {
          id: true,
          rating: true,
          createdAt: true,
          user: { select: { name: true } },
          course: { select: { title: true } },
        },
      }),
      // AssignmentSubmission carries only the denormalized courseId; the
      // course title comes through the assignment's course relation.
      db.assignmentSubmission.findMany({
        orderBy: { submittedAt: "desc" },
        take: ACTIVITY_SOURCE_TAKE,
        select: {
          id: true,
          submittedAt: true,
          user: { select: { name: true } },
          assignment: { select: { course: { select: { title: true } } } },
        },
      }),
      db.certificate.findMany({
        orderBy: { issuedAt: "desc" },
        take: ACTIVITY_SOURCE_TAKE,
        select: {
          id: true,
          issuedAt: true,
          user: { select: { name: true } },
          course: { select: { title: true } },
        },
      }),
    ]);

  const candidates: ActivityCandidate[] = [
    ...latestEnrolments.map((row): ActivityCandidate => ({
      id: row.id,
      kind: "ENROLMENT",
      actorName: row.user.name,
      courseTitle: row.course.title,
      summary: `enrolled in ${row.course.title}`,
      occurredAt: row.createdAt,
    })),
    ...latestReviews.map((row): ActivityCandidate => ({
      id: row.id,
      kind: "REVIEW",
      actorName: row.user.name,
      courseTitle: row.course.title,
      summary: `reviewed ${row.course.title} (rated ${row.rating}/5)`,
      occurredAt: row.createdAt,
    })),
    ...latestSubmissions.map((row): ActivityCandidate => ({
      id: row.id,
      kind: "SUBMISSION",
      actorName: row.user.name,
      courseTitle: row.assignment.course.title,
      summary: "submitted assignment for grading",
      occurredAt: row.submittedAt,
    })),
    ...latestCertificates.map((row): ActivityCandidate => ({
      id: row.id,
      kind: "CERTIFICATE",
      actorName: row.user.name,
      courseTitle: row.course.title,
      summary: "earned a certificate",
      occurredAt: row.issuedAt,
    })),
  ];

  const courseById = new Map(courseRows.map((course) => [course.id, course]));
  const courses: AnalyticsCourseRowDto[] = [];
  for (const rank of topCourses) {
    const course = courseById.get(rank.courseId);
    // Enrolments reference courses with onDelete: Restrict, so the row always
    // exists; the guard keeps the mapping honest regardless (same pattern as
    // the learner dashboard).
    if (!course) continue;
    const rollup = rollups.get(rank.courseId) ?? { enrolments: rank.count, completed: 0 };
    courses.push({
      courseId: course.id,
      title: course.title,
      slug: course.slug,
      status: course.status,
      enrolments: rollup.enrolments,
      completionRate: computeCompletionRate(rollup.completed, rollup.enrolments),
      // Stored as SQL NULL when no VISIBLE ratings exist — never a fake 0.
      ratingAverage:
        course.ratingAverage === null ? null : roundRatingAverage(course.ratingAverage.toNumber()),
      ratingCount: course.ratingCount,
      revenueMinor: revenueByCourse.get(course.id) ?? 0,
    });
  }

  return {
    totals: {
      learners: learnerCount,
      activeCourses: activeCourseCount,
      totalEnrolments,
      completedEnrolments,
      completionRate: computeCompletionRate(completedEnrolments, totalEnrolments),
      currency: primaryCurrency,
      grossRevenueMinor: revenue.grossRevenueMinor,
      refundedMinor: revenue.refundedMinor,
      netRevenueMinor: revenue.netRevenueMinor,
      avgRating: roundRatingAverage(reviewStats._avg.rating),
      ratingCount: reviewStats._count._all,
    },
    trend: buildTrendPoints(buckets, enrolmentTally, learnerTally, revenueTally),
    courses,
    recentActivity: mergeRecentActivity(candidates, ANALYTICS_RECENT_ACTIVITY_LIMIT),
    generatedAt: computedAt.toISOString(),
    freshnessSeconds: 0,
    cached: false,
  };
}
