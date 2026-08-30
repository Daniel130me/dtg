import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateAlerts,
  HTTP_DURATION_BUCKETS_MS,
  observeDuration,
  recordAuthRateLimited,
  recordHttpRequest,
  recordJobFailure,
  recordWebhookSignatureFailure,
  resetMetricsForTests,
  setMetricsClockForTests,
  snapshotJson,
  statusClass,
  withMetrics,
} from "@/server/observability/metrics";

describe("metrics registry", () => {
  it("maps HTTP statuses to bounded status classes", () => {
    assert.equal(statusClass(200), "2xx");
    assert.equal(statusClass(201), "2xx");
    assert.equal(statusClass(302), "3xx");
    assert.equal(statusClass(404), "4xx");
    assert.equal(statusClass(429), "4xx");
    assert.equal(statusClass(503), "5xx");
    assert.equal(statusClass(100), "other");
  });

  it("counts requests by status class and 5xx separately", () => {
    resetMetricsForTests();
    recordHttpRequest(200, 10);
    recordHttpRequest(201, 10);
    recordHttpRequest(404, 10);
    recordHttpRequest(500, 10);
    recordHttpRequest(500, 10);

    const counters = snapshotJson().counters;
    assert.equal(counters['http_requests_total{status_class="2xx"}'], 2);
    assert.equal(counters['http_requests_total{status_class="4xx"}'], 1);
    assert.equal(counters['http_requests_total{status_class="5xx"}'], 2);
    assert.equal(counters.http_errors_total, 2);
  });

  it("records rate-limit and auth-abuse signals with bounded labels", () => {
    resetMetricsForTests();
    recordAuthRateLimited("sign-in");
    recordAuthRateLimited("sign-in");
    const counters = snapshotJson().counters;
    assert.equal(counters['auth_rate_limited_total{action="sign-in"}'], 2);
  });

  it("computes deterministic p50/p90/p99 from fixed buckets", () => {
    resetMetricsForTests();
    for (let i = 0; i < 20; i++) observeDuration(40); // <= 50ms bucket
    for (let i = 0; i < 10; i++) observeDuration(400); // <= 500ms bucket
    observeDuration(9000); // <= 10000ms bucket

    const histogram = snapshotJson().histogram;
    assert.deepEqual(
      histogram.buckets.map((bucket) => bucket.le),
      [...HTTP_DURATION_BUCKETS_MS],
    );
    assert.equal(histogram.count, 31);
    assert.equal(histogram.sum, 20 * 40 + 10 * 400 + 9000);
    // cumulative: 20 @50, 30 @500, 31 @10000
    assert.equal(histogram.p50, 50);
    assert.equal(histogram.p90, 500);
    assert.equal(histogram.p99, 10000);
  });

  it("buckets sub-5ms and overflow observations", () => {
    resetMetricsForTests();
    observeDuration(1);
    observeDuration(1);
    observeDuration(25_000);
    const histogram = snapshotJson().histogram;
    assert.equal(histogram.buckets[0].count, 2); // le=5
    assert.equal(histogram.count, 3);
    assert.equal(histogram.p50, 5);
    // p90's cumulative target only completes inside the implicit +Inf bucket,
    // estimated at the highest finite bound.
    assert.equal(histogram.p90, HTTP_DURATION_BUCKETS_MS[HTTP_DURATION_BUCKETS_MS.length - 1]);
  });

  it("returns null percentiles for an empty histogram", () => {
    resetMetricsForTests();
    const histogram = snapshotJson().histogram;
    assert.equal(histogram.count, 0);
    assert.equal(histogram.p50, null);
    assert.equal(histogram.p99, null);
  });

  it("labels generic withMetrics operations by outcome", async () => {
    resetMetricsForTests();
    const value = await withMetrics("demo_op", async () => "done");
    assert.equal(value, "done");
    await assert.rejects(withMetrics("demo_op", async () => Promise.reject(new Error("no"))));

    const counters = snapshotJson().counters;
    assert.equal(counters['demo_op{outcome="ok"}'], 1);
    assert.equal(counters['demo_op{outcome="error"}'], 1);
  });

  it("adds process gauges to every snapshot", () => {
    resetMetricsForTests();
    setMetricsClockForTests(() => 10_000_000);
    const snapshot = snapshotJson();
    assert.ok((snapshot.gauges.process_uptime_seconds ?? 0) >= 0);
    assert.ok((snapshot.gauges.process_memory_heap_bytes as number) > 0);
    assert.equal(snapshot.histogram.name, "http_request_duration_ms");
    assert.ok(snapshot.generatedAt.length > 0);
    resetMetricsForTests();
  });

  it("resets all state", () => {
    resetMetricsForTests();
    recordHttpRequest(500, 10);
    observeDuration(10);
    resetMetricsForTests();
    const snapshot = snapshotJson();
    assert.deepEqual(snapshot.counters, {});
    assert.equal(snapshot.histogram.count, 0);
  });
});

describe("alert evaluation", () => {
  it("needs a minimum window before reporting the 5xx rate", () => {
    resetMetricsForTests();
    for (let i = 0; i < 19; i++) recordHttpRequest(500, 5);
    // 19 samples (all 5xx) is below the minimum window: no alert yet.
    assert.deepEqual(evaluateAlerts(), []);
    recordHttpRequest(500, 5); // 20 x 5xx = 100% error rate
    const alerts = evaluateAlerts();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].name, "http_5xx_error_rate");
    assert.equal(alerts[0].value, 1);
    assert.equal(alerts[0].threshold, 0.05);
    resetMetricsForTests();
  });

  it("does not alert when the 5xx rate is at or below the threshold", () => {
    resetMetricsForTests();
    for (let i = 0; i < 19; i++) recordHttpRequest(200, 5);
    recordHttpRequest(500, 5); // 1/20 = exactly 5% (not > 5%)
    assert.deepEqual(evaluateAlerts(), []);
    resetMetricsForTests();
  });

  it("alerts on 5 webhook signature failures within the event window", () => {
    resetMetricsForTests();
    let now = 1_000_000;
    setMetricsClockForTests(() => now);
    for (let i = 0; i < 4; i++) recordWebhookSignatureFailure();
    assert.deepEqual(evaluateAlerts(), []);
    recordWebhookSignatureFailure(); // 5th failure (>= 5)
    let alerts = evaluateAlerts();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].name, "webhook_signature_failures");
    assert.equal(alerts[0].value, 5);

    // Outside the 15-minute window the same failures stop alerting.
    now += 15 * 60_000 + 1;
    alerts = evaluateAlerts();
    assert.deepEqual(alerts, []);
    resetMetricsForTests();
  });

  it("alerts when the outbox oldest pending age exceeds 300s", () => {
    resetMetricsForTests();
    assert.deepEqual(evaluateAlerts({ outboxOldestPendingAgeSeconds: 300 }), []);
    assert.deepEqual(evaluateAlerts({ outboxOldestPendingAgeSeconds: null }), []);
    const alerts = evaluateAlerts({ outboxOldestPendingAgeSeconds: 300.5 });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].name, "outbox_oldest_pending_age_seconds");
    assert.equal(alerts[0].threshold, 300);
    resetMetricsForTests();
  });

  it("alerts after more than 10 job failures in the window", () => {
    resetMetricsForTests();
    let now = 2_000_000;
    setMetricsClockForTests(() => now);
    for (let i = 0; i < 10; i++) recordJobFailure("outbox.dispatch");
    assert.deepEqual(evaluateAlerts(), []); // 10 is not > 10
    recordJobFailure("outbox.dispatch");
    const alerts = evaluateAlerts();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].name, "job_failures");
    assert.equal(alerts[0].value, 11);
    resetMetricsForTests();
  });
});
