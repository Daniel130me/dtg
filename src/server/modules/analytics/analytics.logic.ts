// Pure, DB-free analytics rules so they stay unit-testable without a
// database. docs/ANALYTICS_METRICS.md is the definition of record for every
// metric below; when a formula changes, the doc, this module and the fixtures
// in tests/unit/analytics.test.ts move in the same commit.
//
// House rules honoured here: all bucketing is UTC with plain date arithmetic
// (never NOW()-interval math, so a fixed `now` yields identical buckets in
// tests) and money stays integer minor units end to end.

import type {
  AnalyticsActivityItemDto,
  AnalyticsActivityKind,
  AnalyticsTrendPointDto,
} from "@/contracts/analytics";
import { ANALYTICS_RECENT_ACTIVITY_LIMIT } from "@/contracts/analytics";

// ---------------------------------------------------------------------------
// Month buckets (trend window)
// ---------------------------------------------------------------------------

/** ASCII month abbreviations — labels are locale-independent by contract. */
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface MonthBucket {
  /** "YYYY-MM" UTC month key. */
  key: string;
  /** Display label, e.g. "Jan 2026". */
  label: string;
  /** First instant of the month (inclusive), UTC. */
  startUtc: Date;
  /** First instant of the next month (exclusive), UTC. */
  endUtc: Date;
}

/**
 * The last `months` UTC month buckets including the current, incomplete month
 * (docs/ANALYTICS_METRICS.md "Trend window"), oldest first. Built with plain
 * Date.UTC arithmetic: Date.UTC normalizes overflowing month indices, so
 * year boundaries need no special cases and the same `now` always produces
 * the same buckets.
 */
export function buildMonthBuckets(now: Date, months: number): MonthBucket[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const buckets: MonthBucket[] = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const startUtc = new Date(Date.UTC(year, month - offset, 1));
    // Half-open range [startUtc, endUtc): a row exactly at a month boundary
    // belongs to the newer month.
    const endUtc = new Date(Date.UTC(year, month - offset + 1, 1));
    buckets.push({
      key: monthKeyOf(startUtc),
      label: `${MONTH_LABELS[startUtc.getUTCMonth()]} ${startUtc.getUTCFullYear()}`,
      startUtc,
      endUtc,
    });
  }
  return buckets;
}

function monthKeyOf(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// ---------------------------------------------------------------------------
// Rates and money
// ---------------------------------------------------------------------------

/**
 * Platform completion-rate formula (doc "Totals"): round to the nearest
 * integer percent of enrolments the learner still holds or finished; `null`
 * when the denominator is 0 (an empty platform renders "—", never 0%).
 */
export function computeCompletionRate(completed: number, inScope: number): number | null {
  if (inScope === 0) return null;
  return Math.round((100 * completed) / inScope);
}

/** Doc default when no payment has ever succeeded: the launch currency. */
const DEFAULT_PRIMARY_CURRENCY = "NGN";

function normalizePlatformCurrency(currency: string): string {
  return currency === "USD" ? "NGN" : currency;
}

/**
 * Primary currency = the one with the highest count among the payment rows
 * the caller passes (the service passes SUCCEEDED payments, matching the
 * doc's "highest-volume currency"). Ties break lexicographically so the
 * winner never depends on row or insertion order; no rows -> "NGN".
 */
export function pickPrimaryCurrency(payments: ReadonlyArray<{ currency: string }>): string {
  const counts = new Map<string, number>();
  for (const payment of payments) {
    const normalizedCurrency = normalizePlatformCurrency(payment.currency);
    counts.set(normalizedCurrency, (counts.get(normalizedCurrency) ?? 0) + 1);
  }
  // Sort keys first so the strict `>` below keeps the lexicographically
  // smallest currency on a tie, independent of Map iteration order.
  const entries = [...counts.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  let winner = DEFAULT_PRIMARY_CURRENCY;
  let winnerCount = 0;
  for (const [currency, count] of entries) {
    if (count > winnerCount) {
      winner = currency;
      winnerCount = count;
    }
  }
  return winner;
}

export interface RevenueTotals {
  grossRevenueMinor: number;
  refundedMinor: number;
  netRevenueMinor: number;
}

/**
 * Headline revenue for one currency (doc "Totals"): SUCCEEDED payments minus
 * SUCCEEDED refunds. Rows in any other currency are excluded — the doc bans
 * invented conversion rates. Refund rows carry the payment's currency (both
 * are copied from the order at checkout), so filtering the refund rows by
 * their own currency equals "refunds of primary-currency payments". Net is
 * never negative-clamped: the doc explicitly allows a negative net.
 */
export function sumRevenue(
  payments: ReadonlyArray<{ amountMinor: number; currency: string }>,
  refunds: ReadonlyArray<{ amountMinor: number; currency: string }>,
  primaryCurrency: string,
): RevenueTotals {
  const grossRevenueMinor = sumAmounts(payments, primaryCurrency);
  const refundedMinor = sumAmounts(refunds, primaryCurrency);
  return { grossRevenueMinor, refundedMinor, netRevenueMinor: grossRevenueMinor - refundedMinor };
}

function sumAmounts(
  rows: ReadonlyArray<{ amountMinor: number; currency: string }>,
  primaryCurrency: string,
): number {
  return rows.reduce(
    (total, row) => (normalizePlatformCurrency(row.currency) === primaryCurrency ? total + row.amountMinor : total),
    0,
  );
}

// ---------------------------------------------------------------------------
// Bucketing rows into the trend window
// ---------------------------------------------------------------------------

/**
 * Groups rows into the given month buckets (half-open [startUtc, endUtc)).
 * Rows outside the window are dropped — the trend never shows them, and the
 * service relies on this to slice all-time reads into the window in JS.
 * Buckets with no rows are simply absent from the map; the trend builder
 * below zero-fills them.
 */
export function bucketByMonth<T>(
  rows: ReadonlyArray<T>,
  getDate: (row: T) => Date,
  buckets: ReadonlyArray<MonthBucket>,
): Map<string, T[]> {
  const byMonth = new Map<string, T[]>();
  for (const row of rows) {
    const date = getDate(row);
    const bucket = buckets.find((candidate) => candidate.startUtc <= date && date < candidate.endUtc);
    if (!bucket) continue;
    const group = byMonth.get(bucket.key) ?? [];
    group.push(row);
    byMonth.set(bucket.key, group);
  }
  return byMonth;
}

/**
 * Per-bucket totals: counts rows per month when `getAmount` returns 1
 * (enrolments, new learners) or sums amounts per month for revenue tallies.
 */
export function tallyPerBucket<T>(
  rows: ReadonlyArray<T>,
  getDate: (row: T) => Date,
  buckets: ReadonlyArray<MonthBucket>,
  getAmount: (row: T) => number,
): Map<string, number> {
  const byMonth = bucketByMonth(rows, getDate, buckets);
  const tallies = new Map<string, number>();
  for (const [key, group] of byMonth) {
    tallies.set(key, group.reduce((total, row) => total + getAmount(row), 0));
  }
  return tallies;
}

/**
 * Trend points for the wire: every bucket becomes a row, zero-filled when a
 * month had no activity (doc "Error/edge semantics": trends are zero-filled,
 * never omitted).
 */
export function buildTrendPoints(
  buckets: ReadonlyArray<MonthBucket>,
  enrolmentsByMonth: ReadonlyMap<string, number>,
  newLearnersByMonth: ReadonlyMap<string, number>,
  revenueByMonth: ReadonlyMap<string, number>,
): AnalyticsTrendPointDto[] {
  return buckets.map((bucket) => ({
    month: bucket.key,
    label: bucket.label,
    enrolments: enrolmentsByMonth.get(bucket.key) ?? 0,
    newLearners: newLearnersByMonth.get(bucket.key) ?? 0,
    revenueMinor: revenueByMonth.get(bucket.key) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Enrolment rollups (top courses)
// ---------------------------------------------------------------------------

/**
 * REVOKED handling decision: excluded HERE, not by callers. The doc's
 * "non-REVOKED rule" is part of the metric definition, so the filter lives
 * with the metric — every rollup below skips REVOKED rows identically.
 */

export interface CourseEnrolmentRank {
  courseId: string;
  count: number;
}

/**
 * Courses ranked by their non-REVOKED enrolment count (doc "Course rows").
 * Ties break lexicographically by course id so the ordering is deterministic
 * regardless of DB row order; the list is truncated to `limit`.
 */
export function rankTopCourses(
  rows: ReadonlyArray<{ courseId: string; status: string }>,
  limit: number,
): CourseEnrolmentRank[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "REVOKED") continue;
    counts.set(row.courseId, (counts.get(row.courseId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([courseId, count]) => ({ courseId, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : 0),
    )
    .slice(0, limit);
}

export interface CourseEnrolmentRollup {
  /** Non-REVOKED enrolments — the completion-rate denominator. */
  enrolments: number;
  /** COMPLETED subset — the completion-rate numerator. */
  completed: number;
}

/** Per-course enrolment/completed counts over all-time, non-REVOKED rows. */
export function enrolmentRollupByCourse(
  rows: ReadonlyArray<{ courseId: string; status: string }>,
): Map<string, CourseEnrolmentRollup> {
  const rollups = new Map<string, CourseEnrolmentRollup>();
  for (const row of rows) {
    if (row.status === "REVOKED") continue;
    const rollup = rollups.get(row.courseId) ?? { enrolments: 0, completed: 0 };
    rollup.enrolments += 1;
    if (row.status === "COMPLETED") rollup.completed += 1;
    rollups.set(row.courseId, rollup);
  }
  return rollups;
}

/**
 * Per-course revenue attribution (doc "Course rows"): a SUCCEEDED payment in
 * the primary currency counts toward each course on its order's items.
 * Checkout orders are single-course today, so this is exact; if multi-item
 * orders ever exist, the payment's full amount lands on every course it paid
 * for — course rows are ranked independently and never summed back into a
 * platform figure, so the headline totals stay untouched.
 */
export function revenueMinorByCourse(
  payments: ReadonlyArray<{ amountMinor: number; currency: string; courseIds: ReadonlyArray<string> }>,
  primaryCurrency: string,
): Map<string, number> {
  const byCourse = new Map<string, number>();
  for (const payment of payments) {
    if (payment.currency !== primaryCurrency) continue;
    for (const courseId of payment.courseIds) {
      byCourse.set(courseId, (byCourse.get(courseId) ?? 0) + payment.amountMinor);
    }
  }
  return byCourse;
}

// ---------------------------------------------------------------------------
// Recent activity feed
// ---------------------------------------------------------------------------

/** One mergeable event from a bounded per-source read. */
export interface ActivityCandidate {
  id: string;
  kind: AnalyticsActivityKind;
  actorName: string;
  courseTitle: string | null;
  summary: string;
  occurredAt: Date;
}

/**
 * Merges the per-source activity candidates newest first and slices to the
 * feed limit. Array#sort is stable (ES2019+), so events with identical
 * timestamps keep their insertion order — the service feeds sources in a
 * fixed order, making the merged feed deterministic.
 */
export function mergeRecentActivity(
  candidates: ReadonlyArray<ActivityCandidate>,
  limit: number = ANALYTICS_RECENT_ACTIVITY_LIMIT,
): AnalyticsActivityItemDto[] {
  return [...candidates]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit)
    .map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      actorName: candidate.actorName,
      courseTitle: candidate.courseTitle,
      summary: candidate.summary,
      // Every wire timestamp leaves this module as an ISO string.
      occurredAt: candidate.occurredAt.toISOString(),
    }));
}
