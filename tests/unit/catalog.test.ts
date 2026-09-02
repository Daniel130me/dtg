import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COURSE_PAGE_LIMIT_DEFAULT,
  COURSE_PAGE_LIMIT_MAX,
  COURSE_SEARCH_MAX_LENGTH,
  FREE_PRICE_MINOR,
  NEW_BADGE_WINDOW_MS,
  POPULAR_ENROLLMENT_THRESHOLD,
  courseListQuerySchema,
  deriveBadge,
} from "@/contracts/catalog";
import { openApiDocument } from "@/server/http/openapi";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const ONE_MINUTE_MS = 60_000;
const PAID_PRICE_MINOR = 4_900;

describe("course badge derivation", () => {
  it("prefers free over new and popular", () => {
    assert.equal(
      deriveBadge(
        {
          priceMinor: FREE_PRICE_MINOR,
          publishedAt: NOW,
          enrollmentCount: POPULAR_ENROLLMENT_THRESHOLD,
        },
        NOW,
      ),
      "free",
    );
  });

  it("prefers new over popular within the publication window", () => {
    const publishedAt = new Date(NOW.getTime() - NEW_BADGE_WINDOW_MS + ONE_MINUTE_MS);
    assert.equal(
      deriveBadge(
        { priceMinor: PAID_PRICE_MINOR, publishedAt, enrollmentCount: POPULAR_ENROLLMENT_THRESHOLD },
        NOW,
      ),
      "new",
    );
  });

  it("marks high-enrolment courses as popular once the window has passed", () => {
    const publishedAt = new Date(NOW.getTime() - NEW_BADGE_WINDOW_MS - ONE_MINUTE_MS);
    assert.equal(
      deriveBadge(
        { priceMinor: PAID_PRICE_MINOR, publishedAt, enrollmentCount: POPULAR_ENROLLMENT_THRESHOLD },
        NOW,
      ),
      "popular",
    );
  });

  it("returns null for plain courses and treats a missing publication date as not new", () => {
    const publishedAt = new Date(NOW.getTime() - NEW_BADGE_WINDOW_MS - ONE_MINUTE_MS);
    assert.equal(
      deriveBadge({ priceMinor: PAID_PRICE_MINOR, publishedAt, enrollmentCount: 1 }, NOW),
      null,
    );
    assert.equal(
      deriveBadge({ priceMinor: PAID_PRICE_MINOR, publishedAt: null, enrollmentCount: 1 }, NOW),
      null,
    );
  });

  it("excludes courses published exactly at the window boundary", () => {
    assert.equal(
      deriveBadge(
        {
          priceMinor: PAID_PRICE_MINOR,
          publishedAt: new Date(NOW.getTime() - NEW_BADGE_WINDOW_MS),
          enrollmentCount: 0,
        },
        NOW,
      ),
      null,
    );
  });

  it("accepts ISO publication dates as well as Date objects", () => {
    const publishedAt = new Date(NOW.getTime() - ONE_MINUTE_MS).toISOString();
    assert.equal(deriveBadge({ priceMinor: PAID_PRICE_MINOR, publishedAt, enrollmentCount: 0 }, NOW), "new");
  });
});

describe("course list query parsing", () => {
  it("applies the documented defaults", () => {
    assert.deepEqual(courseListQuerySchema.parse({}), {
      price: "ALL",
      sort: "NEWEST",
      limit: COURSE_PAGE_LIMIT_DEFAULT,
    });
  });

  it("coerces numeric strings coming from the query string", () => {
    const query = courseListQuerySchema.parse({ limit: "5", sort: "PRICE_ASC", price: "FREE" });
    assert.equal(query.limit, 5);
    assert.equal(query.sort, "PRICE_ASC");
    assert.equal(query.price, "FREE");
  });

  it("keeps optional filters when present", () => {
    const query = courseListQuerySchema.parse({
      search: "react",
      category: "web-development",
      level: "BEGINNER",
    });
    assert.equal(query.search, "react");
    assert.equal(query.category, "web-development");
    assert.equal(query.level, "BEGINNER");
  });

  it("accepts owner-managed levels and rejects invalid levels or limits", () => {
    assert.equal(courseListQuerySchema.safeParse({ level: "EXPERT" }).success, true);
    assert.equal(courseListQuerySchema.safeParse({ level: "   " }).success, false);
    assert.equal(courseListQuerySchema.safeParse({ level: "a".repeat(81) }).success, false);
    assert.equal(
      courseListQuerySchema.safeParse({ limit: String(COURSE_PAGE_LIMIT_MAX + 1) }).success,
      false,
    );
    assert.equal(courseListQuerySchema.safeParse({ limit: "0" }).success, false);
    assert.equal(courseListQuerySchema.safeParse({ limit: "many" }).success, false);
  });

  it("rejects oversized search terms but accepts the boundary", () => {
    assert.equal(
      courseListQuerySchema.safeParse({ search: "a".repeat(COURSE_SEARCH_MAX_LENGTH + 1) }).success,
      false,
    );
    assert.equal(
      courseListQuerySchema.safeParse({ search: "a".repeat(COURSE_SEARCH_MAX_LENGTH) }).success,
      true,
    );
  });
});

describe("catalog API documentation", () => {
  it("documents the public catalog endpoints", () => {
    assert.ok(openApiDocument.paths["/catalog/categories"]);
    assert.ok(openApiDocument.paths["/courses"]);
    assert.ok(openApiDocument.paths["/courses/{slug}"]);
  });
});
