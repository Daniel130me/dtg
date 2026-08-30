// Pure, DB-free review rules so they stay unit-testable without a database.
// The reviews service owns the queries; this module owns every decision worth
// testing (aggregate math, the verified-enrolment gate, normalization, owner
// reply fan-out, excerpt truncation) plus the audit action vocabulary.

import type { CourseRatingAggregateDto, ReviewStatusValue } from "@/contracts/reviews";

// ---------------------------------------------------------------------------
// Audit action vocabulary (no magic strings at call sites)
// ---------------------------------------------------------------------------

export const REVIEW_AUDIT = {
  created: "review.created",
  updated: "review.updated",
  withdrawn: "review.withdrawn",
  moderated: "review.moderated",
  replied: "review.replied",
} as const;

// ---------------------------------------------------------------------------
// Rating aggregates
// ---------------------------------------------------------------------------

/** Decimals kept on the denormalized Course.ratingAverage (schema: Decimal(3,2)). */
export const RATING_AVERAGE_DECIMALS = 2;

/**
 * Null-safe rounding to the stored precision. Null means "no visible ratings",
 * which the Course row stores as SQL NULL (never 0 — that would fake a score).
 */
export function roundRatingAverage(value: number | null): number | null {
  if (value === null || Number.isNaN(value)) return null;
  return Number(value.toFixed(RATING_AVERAGE_DECIMALS));
}

/**
 * Aggregate over an in-memory page of ratings. Kept alongside the
 * Prisma-aggregate variant below so both paths share one rounding rule.
 */
export function computeRatingAggregate(rows: readonly { rating: number }[]): CourseRatingAggregateDto {
  if (rows.length === 0) return { ratingCount: 0, ratingAverage: null };
  const sum = rows.reduce((total, row) => total + row.rating, 0);
  return {
    ratingCount: rows.length,
    ratingAverage: roundRatingAverage(sum / rows.length),
  };
}

/** Shape of Prisma's `review.aggregate({ _avg: { rating }, _count: { _all } })`. */
export interface RatingAggregateStats {
  _avg: { rating: number | null };
  _count: { _all: number };
}

/** Maps the transactional aggregate query result onto the contract DTO. */
export function toRatingAggregate(stats: RatingAggregateStats): CourseRatingAggregateDto {
  return {
    ratingCount: stats._count._all,
    ratingAverage: roundRatingAverage(stats._avg.rating),
  };
}

// ---------------------------------------------------------------------------
// Learner upsert decisions
// ---------------------------------------------------------------------------

export interface ReviewUpsertFields {
  rating: number;
  body: string;
}

/**
 * Trims the body defensively. The wire schema already trims, so this is
 * idempotent — it exists so internal callers (replays, seeds, tests) can never
 * smuggle whitespace-only padding past the gates.
 */
export function normalizeReviewUpsert(input: ReviewUpsertFields): ReviewUpsertFields {
  return { rating: input.rating, body: input.body.trim() };
}

export type ReviewWriteEligibility = "ELIGIBLE" | "ENROLMENT_REQUIRED" | "COURSE_NOT_FOUND";

/**
 * Single decision point for writing (or editing) a review:
 * - the course must be PUBLISHED — drafts read as COURSE_NOT_FOUND even for
 *   enrolled learners, mirroring the catalog and lesson-access trust rules;
 * - only a VERIFIED enrolment (ACTIVE or COMPLETED) may hold a review —
 *   REVOKED learners lose the privilege and PENDING payments do not grant it;
 * - everything else is a paywall rejection, never a 404 (the course exists).
 */
export function describeReviewWriteEligibility(input: {
  courseStatus: string | null;
  enrolmentStatus: string | null;
}): ReviewWriteEligibility {
  if (input.courseStatus !== "PUBLISHED") return "COURSE_NOT_FOUND";
  if (input.enrolmentStatus === "ACTIVE" || input.enrolmentStatus === "COMPLETED") {
    return "ELIGIBLE";
  }
  return "ENROLMENT_REQUIRED";
}

// ---------------------------------------------------------------------------
// Owner moderation / reply decisions
// ---------------------------------------------------------------------------

/**
 * Notification fan-out rule for owner replies: only a reply on a VISIBLE
 * review notifies its author. A HIDDEN review is not rendered to its author,
 * so notifying would leak the moderation state the owner chose to apply.
 */
export function shouldEmitOwnerReplyEvent(status: ReviewStatusValue): boolean {
  return status === "VISIBLE";
}

/** Cap for the excerpts shipped in outbox payloads (notification/email copy). */
export const REVIEW_EXCERPT_MAX = 120;

/**
 * First N characters of a body for downstream notification copy. Whitespace is
 * trimmed first so payloads never start or end with dangling spaces; no
 * ellipsis is added — the dispatcher owns the copy framing.
 */
export function buildReviewExcerpt(body: string, max: number = REVIEW_EXCERPT_MAX): string {
  const trimmed = body.trim();
  return trimmed.slice(0, max);
}
