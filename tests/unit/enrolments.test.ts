import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  courseEnrolmentStateSchema,
  enrolmentDtoSchema,
  enrolmentListQuerySchema,
  paginatedEnrolmentsSchema,
} from "@/contracts/enrolments";
import { describeFreeEnrolmentEligibility } from "@/server/modules/enrolments/enrolments.logic";

describe("free enrolment eligibility", () => {
  const freePriceMinor = 0;

  it("allows published free courses", () => {
    assert.deepEqual(
      describeFreeEnrolmentEligibility({ status: "PUBLISHED", priceMinor: 0, freePriceMinor }),
      { eligible: true, blocker: null },
    );
  });

  it("blocks unpublished and archived courses", () => {
    for (const status of ["DRAFT", "ARCHIVED"]) {
      assert.equal(
        describeFreeEnrolmentEligibility({ status, priceMinor: 0, freePriceMinor }).blocker,
        "COURSE_NOT_PUBLISHED",
      );
    }
  });

  it("routes paid courses to checkout instead of free enrolment", () => {
    const result = describeFreeEnrolmentEligibility({
      status: "PUBLISHED",
      priceMinor: 4499,
      freePriceMinor,
    });
    assert.equal(result.blocker, "PAID_COURSE_REQUIRES_CHECKOUT");
  });
});

describe("enrolment list query schema", () => {
  it("applies the documented default limit", () => {
    assert.equal(enrolmentListQuerySchema.parse({}).limit, 12);
  });

  it("coerces numeric strings but rejects out-of-bounds limits", () => {
    assert.equal(enrolmentListQuerySchema.parse({ limit: "5" }).limit, 5);
    assert.throws(() => enrolmentListQuerySchema.parse({ limit: "0" }));
    assert.throws(() => enrolmentListQuerySchema.parse({ limit: "25" }));
    assert.throws(() => enrolmentListQuerySchema.parse({ limit: "abc" }));
  });

  it("accepts only the documented status filters", () => {
    assert.equal(enrolmentListQuerySchema.parse({ status: "ACTIVE" }).status, "ACTIVE");
    assert.equal(enrolmentListQuerySchema.parse({ status: "COMPLETED" }).status, "COMPLETED");
    // REVOKED is a real enrolment state but not a list filter.
    assert.throws(() => enrolmentListQuerySchema.parse({ status: "REVOKED" }));
  });
});

describe("enrolment wire contracts", () => {
  const course = {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    slug: "intro-to-testing",
    title: "Intro to Testing",
    shortDescription: "Learn to test software.",
    level: "BEGINNER",
    language: "English",
    thumbnailUrl: null,
    totalLessons: 4,
    totalMinutes: 32,
    categoryName: "Web Development",
    categorySlug: "web-development",
  };

  const baseEnrolment = {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
    courseId: course.id,
    source: "FREE",
    enrolledAt: "2026-08-29T12:00:00.000Z",
    completedAt: null,
    revokedAt: null,
    course,
    progress: null,
  };

  it("parses a complete enrolment DTO with nullable dates and progress", () => {
    const parsed = enrolmentDtoSchema.parse({
      id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
      courseId: course.id,
      status: "ACTIVE",
      source: "FREE",
      enrolledAt: "2026-08-29T12:00:00.000Z",
      completedAt: null,
      revokedAt: null,
      course,
      progress: { completedLessons: 1, totalLessons: 4, progressPercent: 25 },
    });
    assert.equal(parsed.course.categorySlug, "web-development");
    assert.equal(parsed.completedAt, null);
    assert.equal(parsed.progress?.progressPercent, 25);

    // REVOKED enrolments carry no progress block.
    const revoked = enrolmentDtoSchema.parse({
      ...baseEnrolment,
      status: "REVOKED",
      progress: null,
    });
    assert.equal(revoked.progress, null);
  });

  it("rejects unknown enrolment statuses and sources", () => {
    assert.throws(() => enrolmentDtoSchema.parse({ ...baseEnrolment, status: "PAUSED" }));
    assert.throws(() => enrolmentDtoSchema.parse({ ...baseEnrolment, status: "ACTIVE", source: "GIFT" }));
  });

  it("validates pagination envelopes and state probes", () => {
    const enrolment = {
      id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
      courseId: course.id,
      status: "ACTIVE",
      source: "FREE",
      enrolledAt: "2026-08-29T12:00:00.000Z",
      completedAt: null,
      revokedAt: null,
      course,
      progress: { completedLessons: 0, totalLessons: 4, progressPercent: 0 },
    };
    const page = paginatedEnrolmentsSchema.parse({ items: [enrolment], nextCursor: null, total: 1 });
    assert.equal(page.total, 1);

    assert.deepEqual(courseEnrolmentStateSchema.parse({ enrolled: false, status: null }), {
      enrolled: false,
      status: null,
    });
    assert.throws(() => courseEnrolmentStateSchema.parse({ enrolled: true, status: "PAUSED" }));
  });
});
