import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ownerReviewSchema,
  reviewSchema,
  reviewUpsertSchema,
} from "@/contracts/reviews";
import {
  REVIEW_AUDIT,
  REVIEW_EXCERPT_MAX,
  buildReviewExcerpt,
  computeRatingAggregate,
  describeReviewWriteEligibility,
  normalizeReviewUpsert,
  roundRatingAverage,
  shouldEmitOwnerReplyEvent,
  toRatingAggregate,
} from "@/server/modules/reviews/reviews.logic";

describe("rating aggregate", () => {
  it("answers null for an empty course (never a fake 0-star score)", () => {
    assert.deepEqual(computeRatingAggregate([]), { ratingCount: 0, ratingAverage: null });
  });

  it("passes a single rating through exactly", () => {
    assert.deepEqual(computeRatingAggregate([{ rating: 4 }]), {
      ratingCount: 1,
      ratingAverage: 4,
    });
  });

  it("rounds the mean to 2 decimals", () => {
    assert.deepEqual(computeRatingAggregate([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), {
      ratingCount: 3,
      ratingAverage: 4.33,
    });
    assert.deepEqual(
      computeRatingAggregate([{ rating: 5 }, { rating: 4 }, { rating: 4 }, { rating: 4 }]),
      { ratingCount: 4, ratingAverage: 4.25 },
    );
  });

  it("maps the Prisma aggregate result with the same rounding rule", () => {
    assert.deepEqual(
      toRatingAggregate({ _avg: { rating: null }, _count: { _all: 0 } }),
      { ratingCount: 0, ratingAverage: null },
    );
    assert.deepEqual(
      toRatingAggregate({ _avg: { rating: 4.256 }, _count: { _all: 3 } }),
      { ratingCount: 3, ratingAverage: 4.26 },
    );
  });

  it("treats null and NaN averages as empty, not zero", () => {
    assert.equal(roundRatingAverage(null), null);
    assert.equal(roundRatingAverage(Number.NaN), null);
  });
});

describe("review upsert normalization", () => {
  it("trims the body and keeps the rating untouched", () => {
    assert.deepEqual(normalizeReviewUpsert({ rating: 5, body: "  Great course  " }), {
      rating: 5,
      body: "Great course",
    });
  });

  it("is idempotent (schema-trimmed input stays stable)", () => {
    const once = normalizeReviewUpsert({ rating: 3, body: " Solid " });
    assert.deepEqual(normalizeReviewUpsert(once), once);
  });
});

describe("verified-enrolment gate", () => {
  it("reads draft courses as not-found even for enrolled learners", () => {
    assert.equal(
      describeReviewWriteEligibility({ courseStatus: "DRAFT", enrolmentStatus: "ACTIVE" }),
      "COURSE_NOT_FOUND",
    );
    assert.equal(
      describeReviewWriteEligibility({ courseStatus: "ARCHIVED", enrolmentStatus: "COMPLETED" }),
      "COURSE_NOT_FOUND",
    );
  });

  it("grants ACTIVE and COMPLETED enrolments on published courses", () => {
    for (const status of ["ACTIVE", "COMPLETED"]) {
      assert.equal(
        describeReviewWriteEligibility({ courseStatus: "PUBLISHED", enrolmentStatus: status }),
        "ELIGIBLE",
      );
    }
  });

  it("rejects missing, revoked, or unverified enrolments with the paywall error", () => {
    for (const enrolmentStatus of [null, "REVOKED", "PENDING"]) {
      assert.equal(
        describeReviewWriteEligibility({ courseStatus: "PUBLISHED", enrolmentStatus }),
        "ENROLMENT_REQUIRED",
      );
    }
  });
});

describe("owner reply fan-out", () => {
  it("notifies the author only for VISIBLE reviews", () => {
    assert.equal(shouldEmitOwnerReplyEvent("VISIBLE"), true);
    assert.equal(shouldEmitOwnerReplyEvent("HIDDEN"), false);
  });

  it("caps excerpts at 120 trimmed characters without padding", () => {
    assert.equal(buildReviewExcerpt("  Short and sweet  "), "Short and sweet");
    const long = `${"x".repeat(REVIEW_EXCERPT_MAX + 50)}`;
    assert.equal(buildReviewExcerpt(long).length, REVIEW_EXCERPT_MAX);
  });
});

describe("review wire contracts", () => {
  const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const authorId = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

  const review = {
    id,
    courseId: authorId,
    rating: 5,
    body: "Loved the pacing.",
    status: "VISIBLE",
    reply: "Thanks!",
    repliedAt: "2026-02-02T10:00:00.000Z",
    replyAuthor: { id: authorId, name: "Owner" },
    createdAt: "2026-02-01T10:00:00.000Z",
    updatedAt: "2026-02-02T10:00:00.000Z",
    author: { id, name: "Ada" },
  };

  it("parses a review DTO with an optional reply author", () => {
    const parsed = reviewSchema.parse({ ...review, reply: null, repliedAt: null, replyAuthor: null });
    assert.equal(parsed.replyAuthor, null);
    assert.equal(reviewSchema.parse(review).reply, "Thanks!");
    assert.throws(() => reviewSchema.parse({ ...review, status: "DELETED" }));
  });

  it("extends the owner DTO with course identity", () => {
    const owner = ownerReviewSchema.parse({
      ...review,
      course: { id: authorId, slug: "react-basics", title: "React Basics" },
    });
    assert.equal(owner.course.slug, "react-basics");
  });

  it("enforces the 1..5 integer rating and non-empty body on upsert", () => {
    assert.equal(reviewUpsertSchema.parse({ rating: 1, body: "ok" }).rating, 1);
    assert.throws(() => reviewUpsertSchema.parse({ rating: 0, body: "ok" }));
    assert.throws(() => reviewUpsertSchema.parse({ rating: 6, body: "ok" }));
    assert.throws(() => reviewUpsertSchema.parse({ rating: 3, body: "   " }));
  });

  it("keeps the audit action vocabulary stable", () => {
    assert.deepEqual(REVIEW_AUDIT, {
      created: "review.created",
      updated: "review.updated",
      withdrawn: "review.withdrawn",
      moderated: "review.moderated",
      replied: "review.replied",
    });
  });
});
