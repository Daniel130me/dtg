import { z } from "zod";

// ---------------------------------------------------------------------------
// Named constants (no magic values)
// ---------------------------------------------------------------------------

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;
/** Size limits enforced by the server and mirrored here for client hints. */
export const REVIEW_BODY_MAX = 2000;
export const REVIEW_REPLY_MAX = 2000;

/** Bounded reads: page sizes for the public course review list. */
export const REVIEW_PAGE_LIMIT_DEFAULT = 10;
export const REVIEW_PAGE_LIMIT_MAX = 50;
/** Owner moderation queue page size. */
export const OWNER_REVIEW_PAGE_LIMIT_DEFAULT = 20;
export const OWNER_REVIEW_PAGE_LIMIT_MAX = 100;

/** Client-safe tuple mirroring the Prisma ReviewStatus enum. */
export const REVIEW_STATUSES = ["VISIBLE", "HIDDEN"] as const;
export type ReviewStatusValue = (typeof REVIEW_STATUSES)[number];

/** Client-matchable error codes shared by server and client. */
export const REVIEW_NOT_FOUND = "REVIEW_NOT_FOUND";
export const REVIEW_ENROLMENT_REQUIRED = "REVIEW_ENROLMENT_REQUIRED";
/** Course mismatch guard: a path course slug that doesn't own the review id. */
export const REVIEW_COURSE_MISMATCH = "REVIEW_COURSE_MISMATCH";

// ---------------------------------------------------------------------------
// Query/input contracts
// ---------------------------------------------------------------------------

export const reviewListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(REVIEW_PAGE_LIMIT_MAX)
    .default(REVIEW_PAGE_LIMIT_DEFAULT),
});

export const ownerReviewListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(OWNER_REVIEW_PAGE_LIMIT_MAX)
    .default(OWNER_REVIEW_PAGE_LIMIT_DEFAULT),
  // Omitted -> every moderation state (newest first).
  status: z.enum(REVIEW_STATUSES).optional(),
  courseId: z.uuid().optional(),
});

/** Create-or-update payload for the caller's own review. */
export const reviewUpsertSchema = z.object({
  rating: z.number().int().min(REVIEW_RATING_MIN).max(REVIEW_RATING_MAX),
  body: z.string().trim().min(1).max(REVIEW_BODY_MAX),
});

export const reviewStatusParamSchema = z.enum(REVIEW_STATUSES);

/** Owner reply payload (PUT = upsert; empty strings are rejected here). */
export const reviewReplySchema = z.object({
  reply: z.string().trim().min(1).max(REVIEW_REPLY_MAX),
});

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

export const reviewAuthorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

export const reviewReplyAuthorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

export const reviewSchema = z.object({
  id: z.uuid(),
  courseId: z.uuid(),
  rating: z.number().int().min(REVIEW_RATING_MIN).max(REVIEW_RATING_MAX),
  body: z.string(),
  status: z.enum(REVIEW_STATUSES),
  reply: z.string().nullable(),
  repliedAt: z.iso.datetime().nullable(),
  replyAuthor: reviewReplyAuthorSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  author: reviewAuthorSchema,
});

export type ReviewDto = z.infer<typeof reviewSchema>;

/** The public list only ever carries VISIBLE reviews (moderation filter). */
export const paginatedReviewsSchema = z.object({
  items: z.array(reviewSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

export type PaginatedReviewsDto = z.infer<typeof paginatedReviewsSchema>;

/** Owner moderation rows add the course identity for cross-course triage. */
export const ownerReviewSchema = reviewSchema.extend({
  course: z.object({
    id: z.uuid(),
    slug: z.string(),
    title: z.string(),
  }),
});

export type OwnerReviewDto = z.infer<typeof ownerReviewSchema>;

export const paginatedOwnerReviewsSchema = z.object({
  items: z.array(ownerReviewSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

export type PaginatedOwnerReviewsDto = z.infer<typeof paginatedOwnerReviewsSchema>;

/** Rating aggregate recomputed on every review write (Phase 10 item). */
export const courseRatingAggregateSchema = z.object({
  ratingCount: z.number().int().nonnegative(),
  ratingAverage: z.number().min(0).max(5).nullable(),
});

export type CourseRatingAggregateDto = z.infer<typeof courseRatingAggregateSchema>;
