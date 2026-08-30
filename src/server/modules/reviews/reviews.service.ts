import { CourseStatus, Prisma, ReviewStatus } from "@prisma/client";
import {
  REVIEW_ENROLMENT_REQUIRED,
  REVIEW_NOT_FOUND,
  ownerReviewListQuerySchema,
  reviewListQuerySchema,
  type OwnerReviewDto,
  type PaginatedOwnerReviewsDto,
  type PaginatedReviewsDto,
  type ReviewDto,
  type ReviewStatusValue,
} from "@/contracts/reviews";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";
import {
  REVIEW_AUDIT,
  REVIEW_EXCERPT_MAX,
  buildReviewExcerpt,
  describeReviewWriteEligibility,
  normalizeReviewUpsert,
  shouldEmitOwnerReplyEvent,
  toRatingAggregate,
} from "@/server/modules/reviews/reviews.logic";

// Authorization model: learner review routes resolve the caller through
// requireAuthenticatedUser(headers) and every write is gated on a VERIFIED
// enrolment (ACTIVE or COMPLETED — see describeReviewWriteEligibility). Owner
// routes go through requireOwner(headers) before reaching the moderation
// functions, so those trust the actor and only validate the review row.
//
// Aggregate ownership: Course.ratingAverage/ratingCount are denormalized
// fields owned by THIS service. Every create/update/withdraw/moderate
// recomputes them inside the same transaction from VISIBLE rows only, so the
// public rating can never drift from the moderated state (schema trust-model
// note, prisma/schema.prisma "Engagement (Phase 10)").

// Outbox topics consumed by the Phase 10 notifications dispatcher.
const TOPIC_REVIEW_CREATED = "review.created";
const TOPIC_REVIEW_UPDATED = "review.updated";
const TOPIC_REVIEW_OWNER_REPLIED = "review.owner_replied";

// One select for every review read: the DTO needs the author (user relation)
// and the owner-reply author (replier relation).
const REVIEW_SELECT = {
  id: true,
  courseId: true,
  rating: true,
  body: true,
  status: true,
  reply: true,
  repliedAt: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true } },
  replier: { select: { id: true, name: true } },
} satisfies Prisma.ReviewSelect;

// The owner moderation page adds the course identity for cross-course triage.
const OWNER_REVIEW_SELECT = {
  ...REVIEW_SELECT,
  course: { select: { id: true, slug: true, title: true } },
} satisfies Prisma.ReviewSelect;

interface ReviewRowLike {
  id: string;
  courseId: string;
  rating: number;
  body: string;
  status: ReviewStatus;
  reply: string | null;
  repliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string };
  replier: { id: string; name: string } | null;
}

interface OwnerReviewRowLike extends ReviewRowLike {
  course: { id: string; slug: string; title: string };
}

function toReviewDto(row: ReviewRowLike): ReviewDto {
  return {
    id: row.id,
    courseId: row.courseId,
    rating: row.rating,
    body: row.body,
    status: row.status,
    reply: row.reply,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    replyAuthor: row.replier ? { id: row.replier.id, name: row.replier.name } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    author: row.user,
  };
}

function toOwnerReviewDto(row: OwnerReviewRowLike): OwnerReviewDto {
  return { ...toReviewDto(row), course: row.course };
}

/** A slug that does not resolve to a live course reads as absent (catalog 404). */
const COURSE_ABSENT_ERROR = () =>
  new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");

/** Owner-facing review 404 (a missing id and an absent review look the same). */
const REVIEW_ABSENT_ERROR = () =>
  new ApiError(404, REVIEW_NOT_FOUND, "The review was not found.");

/**
 * Recomputes the course's denormalized rating aggregate from VISIBLE rows
 * (the single write path for Course.ratingAverage/ratingCount). Must be called
 * inside the caller's transaction so the course row and the review rows move
 * together — a moderation flip therefore always moves the public rating.
 */
async function recomputeCourseRatingAggregate(
  tx: Prisma.TransactionClient,
  courseId: string,
): Promise<void> {
  const stats = await tx.review.aggregate({
    where: { courseId, status: ReviewStatus.VISIBLE },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const { ratingCount, ratingAverage } = toRatingAggregate(stats);
  await tx.course.update({
    where: { id: courseId },
    // Null (no visible ratings) is stored as SQL NULL on the Decimal column —
    // never 0, which would fake a zero-star score.
    data: { ratingAverage, ratingCount },
    select: { id: true },
  });
}

/** Shared (createdAt desc, id desc) keyset filter for the newest-first lists. */
function appendKeysetFilter(
  where: Prisma.ReviewWhereInput,
  cursorValue: string,
): void {
  const cursor = decodeCursor(cursorValue);
  const cursorDate = new Date(cursor.createdAt);
  where.AND = [
    {
      OR: [
        { createdAt: { lt: cursorDate } },
        { createdAt: cursorDate, id: { lt: cursor.id } },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Learner + public reads
// ---------------------------------------------------------------------------

/**
 * Public review page for a published course: VISIBLE reviews only, newest
 * first, with author and owner-reply author. Query budget: 3 (course,
 * page, total).
 */
export async function listCourseReviews(
  slug: string,
  input: unknown,
): Promise<PaginatedReviewsDto> {
  const query = reviewListQuerySchema.parse(input);

  const course = await db.course.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  // Mirrors the catalog: draft/archived courses do not exist for the public.
  if (!course || course.status !== CourseStatus.PUBLISHED) throw COURSE_ABSENT_ERROR();

  const where: Prisma.ReviewWhereInput = {
    courseId: course.id,
    // HIDDEN reviews vanish from every public read; the owner console owns
    // moderation, the learner still sees their own row via getMyReview.
    status: ReviewStatus.VISIBLE,
  };
  if (query.cursor) appendKeysetFilter(where, query.cursor);

  const [rows, total] = await Promise.all([
    db.review.findMany({
      where,
      select: REVIEW_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    db.review.count({ where }),
  ]);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = items.at(-1);

  return {
    items: items.map(toReviewDto),
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
        : null,
    total,
  };
}

/**
 * The caller's own review for a course, whatever its moderation status — a
 * HIDDEN learner must still see their row (with its status) so the UI can
 * explain why it is not public. Only the course's existence is required: a
 * course re-drafted after a review keeps its reviews reachable to their
 * authors. Query budget: 2 (course, review).
 */
export async function getMyReview(
  userId: string,
  slug: string,
): Promise<{ review: ReviewDto | null }> {
  const course = await db.course.findUnique({ where: { slug }, select: { id: true } });
  if (!course) throw COURSE_ABSENT_ERROR();

  const review = await db.review.findUnique({
    where: { courseId_userId: { courseId: course.id, userId } },
    select: REVIEW_SELECT,
  });
  return { review: review ? toReviewDto(review) : null };
}

// ---------------------------------------------------------------------------
// Learner writes
// ---------------------------------------------------------------------------

/**
 * Create-or-update the caller's review. VERIFIED-ENROLMENT GATE: the course
 * must be PUBLISHED (404 otherwise) and the caller must hold an ACTIVE or
 * COMPLETED enrolment (422 REVIEW_ENROLMENT_REQUIRED otherwise) — only people
 * who took the course may rate it, so ratings cannot be drive-by votes.
 *
 * Moderation semantics: learner edits touch rating/body only. The owner's
 * HIDDEN verdict is deliberately NOT reset by an edit — hidden content must
 * never reappear behind the owner's back, and un-hiding stays an owner action.
 *
 * Query budget: 7 (course+enrolment, existing review, tx: write, aggregate,
 * course update, audit, outbox).
 */
export async function upsertMyReview(
  userId: string,
  slug: string,
  input: { rating: number; body: string },
  requestId: string,
): Promise<{ review: ReviewDto }> {
  const fields = normalizeReviewUpsert(input);

  // One query resolves the course and the caller's enrolment together (the
  // relation filter matches at most one row: @@unique([userId, courseId])).
  const course = await db.course.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      enrolments: { where: { userId }, select: { status: true }, take: 1 },
    },
  });
  const eligibility = describeReviewWriteEligibility({
    courseStatus: course?.status ?? null,
    enrolmentStatus: course?.enrolments[0]?.status ?? null,
  });
  // COURSE_NOT_FOUND covers both a missing slug and an unpublished course
  // (the `course === null` half keeps the narrowing for the tx below).
  if (eligibility === "COURSE_NOT_FOUND" || course === null) throw COURSE_ABSENT_ERROR();
  if (eligibility === "ENROLMENT_REQUIRED") {
    throw new ApiError(
      422,
      REVIEW_ENROLMENT_REQUIRED,
      "Only enrolled learners can review this course.",
    );
  }

  const courseId = course.id;
  const existing = await db.review.findUnique({
    where: { courseId_userId: { courseId, userId } },
    select: { id: true },
  });

  const review = await withTransaction(async (tx) => {
    const saved = existing
      ? await tx.review.update({
          where: { id: existing.id },
          data: { rating: fields.rating, body: fields.body },
          select: REVIEW_SELECT,
        })
      : await tx.review.create({
          data: { courseId, userId, rating: fields.rating, body: fields.body },
          select: REVIEW_SELECT,
        });

    await recomputeCourseRatingAggregate(tx, courseId);

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: existing ? REVIEW_AUDIT.updated : REVIEW_AUDIT.created,
        entityType: "Review",
        entityId: saved.id,
        requestId,
        metadata: { courseId, rating: fields.rating },
      },
      select: { id: true },
    });

    // One event per (course, learner) upsert via the unique eventKey: a
    // retried request can never duplicate downstream notifications.
    await tx.outboxEvent.create({
      data: {
        eventKey: `review.upsert:${courseId}:${userId}`,
        topic: existing ? TOPIC_REVIEW_UPDATED : TOPIC_REVIEW_CREATED,
        aggregateType: "Review",
        aggregateId: saved.id,
        payload: { courseId, userId, rating: fields.rating },
      },
      select: { id: true },
    });

    return saved;
  });

  return { review: toReviewDto(review) };
}

/**
 * Withdraw the caller's own review. Absent review -> 404 with the
 * learner-facing message so the UI can distinguish "never reviewed" from
 * "already gone". Aggregates move in the same transaction as the delete.
 * Query budget: 6 (course, review, tx: delete, aggregate, course update, audit).
 */
export async function deleteMyReview(
  userId: string,
  slug: string,
  requestId: string,
): Promise<{ deleted: boolean }> {
  const course = await db.course.findUnique({ where: { slug }, select: { id: true } });
  if (!course) throw COURSE_ABSENT_ERROR();

  const existing = await db.review.findUnique({
    where: { courseId_userId: { courseId: course.id, userId } },
    select: { id: true },
  });
  if (!existing) {
    throw new ApiError(404, REVIEW_NOT_FOUND, "You have not reviewed this course yet.");
  }

  await withTransaction(async (tx) => {
    await tx.review.delete({ where: { id: existing.id }, select: { id: true } });
    await recomputeCourseRatingAggregate(tx, course.id);
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: REVIEW_AUDIT.withdrawn,
        entityType: "Review",
        entityId: existing.id,
        requestId,
        metadata: { courseId: course.id },
      },
      select: { id: true },
    });
  });

  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Owner moderation (requireOwner resolved in the route)
// ---------------------------------------------------------------------------

/**
 * Owner moderation queue across all courses, newest first, filterable by
 * status and course. Every state is listed (unlike the public read) because
 * this page IS the moderation surface. Query budget: 2 (page, total).
 */
export async function listOwnerReviews(
  _actorOwnerId: string,
  input: unknown,
): Promise<PaginatedOwnerReviewsDto> {
  const query = ownerReviewListQuerySchema.parse(input);

  const where: Prisma.ReviewWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.courseId ? { courseId: query.courseId } : {}),
  };
  if (query.cursor) appendKeysetFilter(where, query.cursor);

  const [rows, total] = await Promise.all([
    db.review.findMany({
      where,
      select: OWNER_REVIEW_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    db.review.count({ where }),
  ]);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = items.at(-1);

  return {
    items: items.map(toOwnerReviewDto),
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
        : null,
    total,
  };
}

/**
 * Flip a review's moderation status. Only `status` is written — the owner
 * reply (reply/repliedAt/repliedByUserId) survives moderation untouched, so
 * restoring a review restores the exact conversation that was hidden.
 * Aggregates recompute because only VISIBLE rows count. Query budget: 5
 * (review, tx: update, aggregate, course update, audit).
 */
export async function setReviewStatus(
  actorOwnerId: string,
  reviewId: string,
  status: ReviewStatusValue,
  requestId: string,
): Promise<{ review: OwnerReviewDto }> {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { id: true, courseId: true },
  });
  if (!review) throw REVIEW_ABSENT_ERROR();

  const updated = await withTransaction(async (tx) => {
    const row = await tx.review.update({
      where: { id: review.id },
      data: { status },
      select: OWNER_REVIEW_SELECT,
    });

    await recomputeCourseRatingAggregate(tx, review.courseId);

    await tx.auditLog.create({
      data: {
        actorUserId: actorOwnerId,
        action: REVIEW_AUDIT.moderated,
        entityType: "Review",
        entityId: review.id,
        requestId,
        metadata: { status, courseId: review.courseId },
      },
      select: { id: true },
    });

    return row;
  });

  return { review: toOwnerReviewDto(updated) };
}

/**
 * Upsert the owner reply. The reply is a single updatable text on the review
 * (PUT semantics): each save rewrites reply/repliedAt/repliedByUserId.
 *
 * Outbox: emits review.owner_replied ONLY when the reply lands on a VISIBLE
 * review (see shouldEmitOwnerReplyEvent — a HIDDEN review is not rendered to
 * its author, so notifying would leak the moderation state). The unique
 * eventKey keeps the fan-out at-most-once per review. Query budget: 4
 * (review, tx: update, audit, outbox).
 */
export async function replyToReview(
  actorOwnerId: string,
  reviewId: string,
  reply: string,
  requestId: string,
): Promise<{ review: OwnerReviewDto }> {
  // The pre-read carries everything the transaction needs: the denormalized
  // courseId, the author id, the body (for the excerpt) and the status.
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { id: true, courseId: true, userId: true, body: true, status: true },
  });
  if (!review) throw REVIEW_ABSENT_ERROR();

  const updated = await withTransaction(async (tx) => {
    const row = await tx.review.update({
      where: { id: review.id },
      data: { reply, repliedAt: new Date(), repliedByUserId: actorOwnerId },
      select: OWNER_REVIEW_SELECT,
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actorOwnerId,
        action: REVIEW_AUDIT.replied,
        entityType: "Review",
        entityId: review.id,
        requestId,
        metadata: { courseId: review.courseId },
      },
      select: { id: true },
    });

    if (shouldEmitOwnerReplyEvent(review.status)) {
      await tx.outboxEvent.create({
        data: {
          eventKey: `review.reply:${review.id}`,
          topic: TOPIC_REVIEW_OWNER_REPLIED,
          aggregateType: "Review",
          aggregateId: review.id,
          payload: {
            reviewId: review.id,
            courseId: review.courseId,
            authorUserId: review.userId,
            reviewExcerpt: buildReviewExcerpt(review.body, REVIEW_EXCERPT_MAX),
            replyExcerpt: buildReviewExcerpt(reply, REVIEW_EXCERPT_MAX),
          },
        },
        select: { id: true },
      });
    }

    return row;
  });

  return { review: toOwnerReviewDto(updated) };
}
