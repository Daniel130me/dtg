import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYTICS_RECENT_ACTIVITY_LIMIT,
  ANALYTICS_TOP_COURSES,
  ANALYTICS_TREND_MONTHS,
  analyticsActivityItemSchema,
  ownerAnalyticsSchema,
} from "@/contracts/analytics";
import {
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
  type ActivityCandidate,
} from "@/server/modules/analytics/analytics.logic";

// Fixed clock: Sept 15 2026, 12:00 UTC — mid-month, so the current (partial)
// month must still appear as the newest bucket. No test below may read the
// real clock; the pure logic takes `now` explicitly for exactly this reason.
const NOW = new Date(Date.UTC(2026, 8, 15, 12, 0, 0));

const COURSE_A = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const COURSE_B = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";
const COURSE_C = "3f2504e0-4f89-11d3-9a0c-0305e82c3303";
const COURSE_D = "3f2504e0-4f89-11d3-9a0c-0305e82c3304";

describe("month buckets", () => {
  it("spans the last N months including the current partial one", () => {
    const buckets = buildMonthBuckets(NOW, ANALYTICS_TREND_MONTHS);
    assert.equal(buckets.length, ANALYTICS_TREND_MONTHS);
    assert.deepEqual(
      buckets.map((bucket) => bucket.key),
      ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
    );
    assert.equal(buckets[0].label, "Apr 2026");
    assert.equal(buckets[buckets.length - 1].label, "Sep 2026");
  });

  it("uses exact UTC month boundaries (half-open [start, end))", () => {
    const buckets = buildMonthBuckets(NOW, ANALYTICS_TREND_MONTHS);
    const current = buckets[buckets.length - 1];
    assert.equal(current.key, "2026-09");
    assert.equal(current.startUtc.getTime(), Date.UTC(2026, 8, 1));
    assert.equal(current.endUtc.getTime(), Date.UTC(2026, 9, 1));
    // The fixed `now` (Sept 15) sits inside the current bucket...
    assert.ok(current.startUtc <= NOW && NOW < current.endUtc);
    // ...and every boundary is the first instant of its month, UTC.
    for (const bucket of buckets) {
      assert.equal(bucket.startUtc.getTime(), Date.UTC(bucket.startUtc.getUTCFullYear(), bucket.startUtc.getUTCMonth(), 1));
      assert.equal(bucket.endUtc.getTime(), Date.UTC(bucket.startUtc.getUTCFullYear(), bucket.startUtc.getUTCMonth() + 1, 1));
    }
  });

  it("rolls over year boundaries with plain Date.UTC arithmetic", () => {
    const buckets = buildMonthBuckets(new Date(Date.UTC(2027, 0, 15)), 3);
    assert.deepEqual(
      buckets.map((bucket) => `${bucket.key} (${bucket.label})`),
      ["2026-11 (Nov 2026)", "2026-12 (Dec 2026)", "2027-01 (Jan 2027)"],
    );
  });
});

describe("completion rate", () => {
  it("answers null on a zero denominator (never a fake 0%)", () => {
    assert.equal(computeCompletionRate(0, 0), null);
  });

  it("rounds to the nearest integer percent", () => {
    assert.equal(computeCompletionRate(2, 3), 67);
    assert.equal(computeCompletionRate(1, 3), 33);
    assert.equal(computeCompletionRate(3, 4), 75);
    assert.equal(computeCompletionRate(1, 1), 100);
  });

  it("keeps a legitimate zero (no completions yet)", () => {
    assert.equal(computeCompletionRate(0, 5), 0);
  });
});

describe("primary currency", () => {
  it("falls back to USD when no payment ever succeeded", () => {
    assert.equal(pickPrimaryCurrency([]), "USD");
  });

  it("picks the highest-volume currency regardless of row order", () => {
    assert.equal(
      pickPrimaryCurrency([{ currency: "EUR" }, { currency: "USD" }, { currency: "USD" }, { currency: "USD" }]),
      "USD",
    );
  });

  it("breaks ties lexicographically (deterministic, order-independent)", () => {
    assert.equal(pickPrimaryCurrency([{ currency: "USD" }, { currency: "EUR" }, { currency: "USD" }, { currency: "EUR" }]), "EUR");
    assert.equal(pickPrimaryCurrency([{ currency: "EUR" }, { currency: "EUR" }, { currency: "USD" }, { currency: "USD" }]), "EUR");
  });
});

describe("revenue totals", () => {
  it("excludes rows in non-primary currencies from gross and refunds", () => {
    const totals = sumRevenue(
      [
        { amountMinor: 1000, currency: "USD" },
        { amountMinor: 2500, currency: "USD" },
        { amountMinor: 9999, currency: "EUR" },
      ],
      [{ amountMinor: 500, currency: "EUR" }],
      "USD",
    );
    assert.deepEqual(totals, { grossRevenueMinor: 3500, refundedMinor: 0, netRevenueMinor: 3500 });
  });

  it("subtracts primary-currency refunds from gross (net = gross - refunded)", () => {
    const totals = sumRevenue(
      [
        { amountMinor: 1000, currency: "USD" },
        { amountMinor: 2500, currency: "USD" },
      ],
      [{ amountMinor: 700, currency: "USD" }],
      "USD",
    );
    assert.deepEqual(totals, { grossRevenueMinor: 3500, refundedMinor: 700, netRevenueMinor: 2800 });
  });

  it("never clamps a negative net", () => {
    const totals = sumRevenue(
      [{ amountMinor: 3500, currency: "USD" }],
      [{ amountMinor: 4000, currency: "USD" }],
      "USD",
    );
    assert.equal(totals.netRevenueMinor, -500);
  });
});

describe("month bucketing of dated rows", () => {
  const buckets = buildMonthBuckets(NOW, ANALYTICS_TREND_MONTHS);

  it("lands rows in their month and drops out-of-window rows", () => {
    const rows = [
      { id: "aug-1", createdAt: new Date(Date.UTC(2026, 7, 3)) },
      { id: "aug-2", createdAt: new Date(Date.UTC(2026, 7, 20)) },
      { id: "sep-1", createdAt: new Date(Date.UTC(2026, 8, 15, 12)) },
      { id: "ancient", createdAt: new Date(Date.UTC(2025, 0, 1)) },
    ];
    const tally = tallyPerBucket(rows, (row) => row.createdAt, buckets, () => 1);
    assert.equal(tally.get("2026-08"), 2);
    assert.equal(tally.get("2026-09"), 1);
    assert.equal(tally.has("2025-01"), false);
    assert.equal(tally.size, 2);
  });

  it("treats month boundaries as half-open: start inclusive, end exclusive", () => {
    const rows = [
      { id: "first-instant", createdAt: new Date(Date.UTC(2026, 7, 1)) },
      { id: "next-month-instant", createdAt: new Date(Date.UTC(2026, 8, 1)) },
    ];
    const tally = tallyPerBucket(rows, (row) => row.createdAt, buckets, () => 1);
    assert.equal(tally.get("2026-08"), 1);
    assert.equal(tally.get("2026-09"), 1);
  });

  it("sums amounts per month for revenue tallies", () => {
    const payments = [
      { amountMinor: 1200, updatedAt: new Date(Date.UTC(2026, 7, 10)) },
      { amountMinor: 800, updatedAt: new Date(Date.UTC(2026, 7, 25)) },
      { amountMinor: 500, updatedAt: new Date(Date.UTC(2026, 8, 2)) },
    ];
    const revenue = tallyPerBucket(payments, (row) => row.updatedAt, buckets, (row) => row.amountMinor);
    assert.equal(revenue.get("2026-08"), 2000);
    assert.equal(revenue.get("2026-09"), 500);
  });

  it("zero-fills empty months in the trend, never omitting buckets", () => {
    const enrolments = tallyPerBucket(
      [{ createdAt: new Date(Date.UTC(2026, 7, 9)) }, { createdAt: new Date(Date.UTC(2026, 7, 11)) }],
      (row) => row.createdAt,
      buckets,
      () => 1,
    );
    const trend = buildTrendPoints(buckets, enrolments, new Map(), new Map([["2026-08", 1200]]));
    assert.equal(trend.length, ANALYTICS_TREND_MONTHS);
    assert.deepEqual(
      trend.map((point) => point.month),
      ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
    );
    const august = trend.find((point) => point.month === "2026-08");
    assert.deepEqual(august, { month: "2026-08", label: "Aug 2026", enrolments: 2, newLearners: 0, revenueMinor: 1200 });
    const april = trend.find((point) => point.month === "2026-04");
    assert.deepEqual(april, { month: "2026-04", label: "Apr 2026", enrolments: 0, newLearners: 0, revenueMinor: 0 });
  });
});

describe("top-course ranking", () => {
  const rows = [
    { courseId: COURSE_A, status: "ACTIVE" },
    { courseId: COURSE_A, status: "COMPLETED" },
    { courseId: COURSE_A, status: "ACTIVE" },
    { courseId: COURSE_A, status: "ACTIVE" },
    { courseId: COURSE_C, status: "REVOKED" },
    { courseId: COURSE_C, status: "REVOKED" },
    { courseId: COURSE_D, status: "ACTIVE" },
    { courseId: COURSE_D, status: "ACTIVE" },
    { courseId: COURSE_B, status: "ACTIVE" },
    { courseId: COURSE_B, status: "ACTIVE" },
  ];

  it("excludes REVOKED enrolments and orders by count, ties by course id", () => {
    const ranked = rankTopCourses(rows, ANALYTICS_TOP_COURSES);
    assert.deepEqual(ranked, [
      { courseId: COURSE_A, count: 4 },
      { courseId: COURSE_B, count: 2 },
      { courseId: COURSE_D, count: 2 },
    ]);
  });

  it("respects the limit", () => {
    const ranked = rankTopCourses(rows, 1);
    assert.deepEqual(ranked, [{ courseId: COURSE_A, count: 4 }]);
  });

  it("rolls up per-course completion counts from the same rows", () => {
    const rollups = enrolmentRollupByCourse([...rows, { courseId: COURSE_A, status: "COMPLETED" }]);
    assert.deepEqual(rollups.get(COURSE_A), { enrolments: 5, completed: 2 });
    assert.deepEqual(rollups.get(COURSE_B), { enrolments: 2, completed: 0 });
    // REVOKED rows never dilute the per-course rate either.
    assert.equal(rollups.has(COURSE_C), false);
  });
});

describe("per-course revenue attribution", () => {
  it("attributes primary-currency payments to each course they paid for", () => {
    const byCourse = revenueMinorByCourse(
      [
        { amountMinor: 5000, currency: "USD", courseIds: [COURSE_A] },
        { amountMinor: 3000, currency: "USD", courseIds: [COURSE_A, COURSE_B] },
        { amountMinor: 777, currency: "EUR", courseIds: [COURSE_B] },
      ],
      "USD",
    );
    assert.equal(byCourse.get(COURSE_A), 8000);
    assert.equal(byCourse.get(COURSE_B), 3000);
    assert.equal(byCourse.size, 2);
  });
});

describe("recent activity merge", () => {
  const candidate = (id: string, minutesPast: number): ActivityCandidate => ({
    id,
    kind: "ENROLMENT",
    actorName: "Learner Name",
    courseTitle: "Course Title",
    summary: "enrolled in Course Title",
    occurredAt: new Date(NOW.getTime() - minutesPast * 60_000),
  });

  it("sorts newest first and slices to the feed limit", () => {
    const merged = mergeRecentActivity(
      [
        candidate("oldest", 50),
        candidate("newest", 1),
        candidate("middle", 25),
        candidate("young", 5),
      ],
      3,
    );
    assert.deepEqual(
      merged.map((item) => item.id),
      ["newest", "young", "middle"],
    );
    assert.equal(merged[0].occurredAt, new Date(NOW.getTime() - 60_000).toISOString());
  });

  it("defaults the limit to the contract constant", () => {
    const ten = Array.from({ length: 10 }, (_, index) => candidate(`c-${index}`, index + 1));
    assert.equal(mergeRecentActivity(ten).length, ANALYTICS_RECENT_ACTIVITY_LIMIT);
  });

  it("keeps insertion order on identical timestamps (stable sort)", () => {
    const same = new Date(Date.UTC(2026, 8, 15, 9, 0, 0));
    const merged = mergeRecentActivity([
      { id: "first", kind: "ENROLMENT", actorName: "A", courseTitle: null, summary: "s", occurredAt: same },
      { id: "second", kind: "REVIEW", actorName: "B", courseTitle: null, summary: "s", occurredAt: same },
      { id: "third", kind: "CERTIFICATE", actorName: "C", courseTitle: null, summary: "s", occurredAt: same },
    ]);
    assert.deepEqual(
      merged.map((item) => item.id),
      ["first", "second", "third"],
    );
  });

  it("maps candidates onto the wire item schema (ISO timestamps)", () => {
    const merged = mergeRecentActivity([candidate("wire-1", 2)]);
    const parsed = analyticsActivityItemSchema.parse(merged[0]);
    assert.equal(parsed.id, "wire-1");
    assert.equal(parsed.kind, "ENROLMENT");
    assert.equal(parsed.occurredAt, "2026-09-15T11:58:00.000Z");
  });
});

describe("owner analytics wire contract", () => {
  const trendPoint = (month: string, label: string) => ({
    month,
    label,
    enrolments: 0,
    newLearners: 0,
    revenueMinor: 0,
  });

  const payload = {
    totals: {
      learners: 10,
      activeCourses: 6,
      totalEnrolments: 31,
      completedEnrolments: 6,
      completionRate: 19,
      currency: "USD",
      grossRevenueMinor: 12_345,
      refundedMinor: 345,
      netRevenueMinor: 12_000,
      avgRating: 4.33,
      ratingCount: 3,
    },
    trend: [
      trendPoint("2026-04", "Apr 2026"),
      trendPoint("2026-05", "May 2026"),
      trendPoint("2026-06", "Jun 2026"),
      trendPoint("2026-07", "Jul 2026"),
      trendPoint("2026-08", "Aug 2026"),
      trendPoint("2026-09", "Sep 2026"),
    ],
    courses: [
      {
        courseId: COURSE_A,
        title: "Course A",
        slug: "course-a",
        status: "PUBLISHED",
        enrolments: 5,
        completionRate: 40,
        ratingAverage: 4.5,
        ratingCount: 2,
        revenueMinor: 8000,
      },
    ],
    recentActivity: [
      {
        id: "activity-1",
        kind: "ENROLMENT",
        actorName: "Learner Name",
        courseTitle: "Course A",
        summary: "enrolled in Course A",
        occurredAt: "2026-09-15T11:00:00.000Z",
      },
    ],
    generatedAt: "2026-09-15T12:00:00.000Z",
    freshnessSeconds: 0,
    cached: false,
  };

  it("accepts a well-formed payload", () => {
    assert.equal(ownerAnalyticsSchema.parse(payload).totals.completionRate, 19);
  });

  it("pins the trend to exactly ANALYTICS_TREND_MONTHS buckets", () => {
    assert.throws(() => ownerAnalyticsSchema.parse({ ...payload, trend: payload.trend.slice(0, 5) }));
  });

  it("rejects nullability and enum drift in course rows", () => {
    assert.throws(() =>
      ownerAnalyticsSchema.parse({
        ...payload,
        courses: [{ ...payload.courses[0], status: "RETIRED" }],
      }),
    );
    assert.throws(() =>
      ownerAnalyticsSchema.parse({
        ...payload,
        courses: [{ ...payload.courses[0], completionRate: 140 }],
      }),
    );
  });
});
