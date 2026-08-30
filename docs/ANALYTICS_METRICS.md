# Analytics Metric Contracts (Phase 11)

Every owner-facing metric is defined here once. The implementation
(`src/server/modules/analytics/*`) and the unit-test fixtures
(`tests/unit/analytics.test.ts`) are both written against these definitions;
if a metric changes, this document changes in the same commit.

## Time and range semantics

- **Time zone:** all bucketing and range boundaries are **UTC**. Learner-facing
  surfaces keep their personal time zones; analytics never uses them.
- **Trend window:** the last **6 calendar months including the current,
 incomplete month** (`ANALYTICS_TREND_MONTHS`). A month bucket is keyed
 `YYYY-MM` and spans `[first-day 00:00:00 UTC, next-month first-day)` —
 expressed with plain date comparisons, never `NOW() - interval` math, so the
 buckets are deterministic for tests.
- **Totals window:** all-time, computed from the rows themselves.
- **Freshness:** the read model is computed live and cached in process memory
 for `ANALYTICS_CACHE_TTL_MS` (60 s). `generatedAt` is the instant the cached
 payload was computed and `freshnessSeconds` is its age at response time;
 `cached` reports whether the response came from the cache. No aggregation
 tables or background jobs exist: at launch-scale volume every query stays in
 its documented budget (below), and a materialized view would be the first
 thing to drift from the truth rows. This decision is revisited only when a
 measured query plan exceeds budget.

## Metric definitions

### Totals

| Metric | Formula | Notes |
| --- | --- | --- |
| `learners` | `count(User where deletedAt IS NULL AND role = STUDENT)` | The owner account is not a learner. Suspended learners are still counted (they exist). |
| `activeCourses` | `count(Course where status = PUBLISHED)` | Drafts and archived courses are not "active". |
| `totalEnrolments` | `count(Enrolment where status != REVOKED)` | REVOKED access is removed from every headline metric. |
| `completedEnrolments` | `count(Enrolment where status = COMPLETED)` | |
| `completionRate` | `round(100 * completedEnrolments / (ACTIVE + COMPLETED enrolments))` or `null` | Denominator is enrolments the learner still holds or finished; REVOKED rows never dilute the rate. `null` when the denominator is 0. Rounded to the nearest integer percent. |
| `grossRevenueMinor` | `sum(Payment.amountMinor where status = SUCCEEDED)` | Per currency; the dashboard reports the **primary currency** (highest-volume currency, `USD` at launch) and other currencies are excluded from the headline (see `byCurrency` below). |
| `refundedMinor` | `sum(Refund.amountMinor where status = SUCCEEDED)` for payments in the primary currency | Refunds are negative revenue. |
| `netRevenueMinor` | `grossRevenueMinor - refundedMinor` | Never negative-clamped; a refund-heavy period can show negative net. |
| `avgRating` | `sum(Review.rating where status = VISIBLE) / count(same)` rounded to 2 decimals, or `null` | Platform-wide, VISIBLE reviews only (mirrors the public catalog). |
| `ratingCount` | `count(Review where status = VISIBLE)` | |

Payment currency note: `Payment.currency` is copied from the order at
checkout. Amounts are summed per currency and the primary-currency total is
reported; multi-currency display is out of scope until a second currency
actually exists (no conversion rates are invented).

### Trend point (per month bucket)

| Metric | Formula |
| --- | --- |
| `enrolments` | `count(Enrolment where createdAt in bucket AND status != REVOKED)` |
| `newLearners` | `count(User where createdAt in bucket AND role = STUDENT AND deletedAt IS NULL)` |
| `revenueMinor` | `sum(Payment.amountMinor where SUCCEEDED and success time in bucket)` for the primary currency |

**Payment success time.** `Payment` has no `succeededAt` column. A
`SUCCEEDED` payment is terminal — it never transitions again — so
`Payment.updatedAt` is, for every SUCCEEDED row, the instant it succeeded.
The analytics read model uses `updatedAt` on SUCCEEDED rows only and this
document is the definition of record for that choice.

### Course rows (top courses)

Ranked by enrolment count (same non-REVOKED rule), limited to
`ANALYTICS_TOP_COURSES` (6). Per course:

- `enrolments`: non-REVOKED enrolment count (computed from `Enrolment` rows,
  never the denormalized `Course.enrollmentCount`, which is a display cache).
- `completionRate`: same formula as the platform rate, scoped to the course.
- `ratingAverage` / `ratingCount`: from `Review` rows (VISIBLE), matching the
  reviews module's aggregate semantics.
- `revenueMinor`: SUCCEEDED payments for the course's order items, primary
  currency. Attributed by `OrderItem.courseId`.

### Recent activity

The last `ANALYTICS_RECENT_ACTIVITY_LIMIT` (8) learner-visible events merged
from bounded per-source reads and sorted newest first: enrolments created,
reviews created (VISIBLE only), assignment submissions, certificates issued.
Each item carries `kind`, actor display name, course title, a short summary
and `occurredAt`. The feed is informational; every number on the dashboard
comes from the formulas above, never from this feed.

## Query budget (enforced by the service)

- `GET /api/v1/owner/analytics` — at most **12 reads** in 2 sequential rounds,
  all indexed or bounded (corrected from the planned 8: the shipped read model
  spends 12 round-trips — the enrolment line merged into one all-time read,
  and recent activity is 4 bounded reads, not 3): 1. all-time non-REVOKED
  enrolment rows (the totals, the monthly buckets, AND the per-course rollup
  come from this single read, aggregated in JS); 2. learner count; 3.
  new-learner buckets (window-bounded); 4. course count; 5. review aggregate;
  6. payment rows (all-time, trend bucketed in JS); 7. refund rows; 8. course
  rows for exactly the ranked top courses; 9-12. recent activity (latest
  enrolments, VISIBLE reviews, submissions, certificates — each a bounded
  take). All cached for 60 s.
- `GET /api/v1/owner/students` — 3 reads (page of users, enrolment groupBy for
  the page, last-activity groupBy for the page).
- `GET /api/v1/owner/students/{id}` — 3 reads (user, enrolments+course, and
  per-course completion counts).
- Export jobs — cursor-bounded iteration capped at `EXPORT_MAX_ROWS` (5 000).

## Exports

- `POST /api/v1/owner/exports { type: ENROLMENTS | STUDENTS }` creates a job,
  processes it inline, stores the CSV bounded by `EXPORT_MAX_ROWS` rows, and
  marks it `COMPLETED` with `expiresAt = completedAt + EXPORT_TTL_HOURS (24 h)`.
- **Deviation from the plan's "private R2 delivery":** this environment has no
  object storage (the Phase 5 R2 integration was not built). The CSV is stored
  in the row and streamed by the owner-only download endpoint
  `GET /api/v1/owner/exports/{id}/download`, which enforces the same
  properties: authorization (OWNER + platform owner), expiry (410 after
  `expiresAt`, job flipped to `EXPIRED`), download counters, and an audit-log
  record for both creation and download. When R2 lands, only the storage step
  inside `exports.service.ts` changes.

## Student management

- Search matches name or email (case-insensitive `contains`), `q` trimmed,
  max 100 chars. Page size default 20, max 50, cursor-paginated
  (`(status, createdAt, id)` keyset on `User`).
- Field-minimized rows: id, name, email, role, status, createdAt,
  enrolmentCount, lastActivityAt. `lastActivityAt = max(LessonProgress
  .completedAt)` or `null` when the learner has no completion activity.
- Status changes (`POST /api/v1/owner/users/{id}/status`): ACTIVE ⇄
  SUSPENDED. Guards: cannot target self, cannot target the OWNER role,
  unknown user → 404. Suspending deletes the target's sessions (immediate
  logout) and writes an audit record; reactivating only flips the status.
  DELETED users are never listed and never restorable from this endpoint.

## Error/edge semantics

- Empty platform (no rows): every rate is `null` (rendered as "—"), trends are
  zero-filled for all 6 buckets, never omitted.
- REVOKED enrolments are excluded everywhere except the raw export rows, which
  are labeled with their status (exports are data records, not metrics).
