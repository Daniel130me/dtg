import { getReleaseInfo } from "@/server/observability/release";

// ---------------------------------------------------------------------------
// In-process metrics registry (Phase 12).
//
// PURE by design: no env, no db, no logger imports — only the release module
// (which is itself dependency-free), so unit tests run without a database.
// Database-scraped gauges live in metrics.snapshot.ts, which imports db.
//
// Cardinality discipline: counters label by bounded value sets only
// (status_class, outcome, status, namespace, action, name-from-fixed-vocabulary)
// — never by pathname or identifier.
// ---------------------------------------------------------------------------

export const HTTP_DURATION_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

/** Rolling request window for alert evaluation (last N requests). */
export const HTTP_REQUEST_WINDOW_SIZE = 500;
/** Minimum samples before the 5xx-rate alert is meaningful. */
export const HTTP_ERROR_RATE_MIN_WINDOW = 20;
export const HTTP_ERROR_RATE_THRESHOLD = 0.05;
/** Time-based window for event-style alerts (signature failures, job failures). */
export const EVENT_ALERT_WINDOW_MS = 15 * 60_000;
export const WEBHOOK_SIGNATURE_FAILURE_THRESHOLD = 5;
export const OUTBOX_LAG_ALERT_THRESHOLD_SECONDS = 300;
export const JOB_FAILURE_ALERT_THRESHOLD = 10;
const EVENT_BUFFER_SIZE = 500;

export type StatusClass = "2xx" | "3xx" | "4xx" | "5xx" | "other";

export interface MetricAlert {
  name: string;
  value: number;
  threshold: number;
  message: string;
}

interface RequestSample {
  status: number;
  durationMs: number;
}

interface JobFailureSample {
  name: string;
  atMs: number;
}

// --- injected clock (pure module, deterministic tests) ----------------------

let clockImpl: () => number = () => Date.now();

/** Test seam: freeze/advance the registry clock. */
export function setMetricsClockForTests(now: () => number): void {
  clockImpl = now;
}

// --- counters ---------------------------------------------------------------

type Labels = Record<string, string>;

const counters = new Map<string, Map<string, number>>();

function labelKey(labels: Labels | undefined): string {
  if (!labels) return "";
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}="${labels[key]}"`)
    .join(",");
}

/** Prometheus-style counter name: `name{a="b",c="d"}` or plain `name`. */
export function formatCounterName(name: string, labels?: Labels): string {
  const key = labelKey(labels);
  return key ? `${name}{${key}}` : name;
}

export function incCounter(name: string, labels?: Labels, amount = 1): void {
  const series = counters.get(name) ?? new Map<string, number>();
  const key = labelKey(labels);
  series.set(key, (series.get(key) ?? 0) + amount);
  counters.set(name, series);
}

function countersJson(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [name, series] of counters) {
    for (const [key, value] of series) {
      result[key ? `${name}{${key}}` : name] = value;
    }
  }
  return result;
}

// --- histogram (fixed buckets, http_request_duration_ms) --------------------

// counts[i] is the cumulative count of observations <= buckets[i]; the final
// slot is the implicit "+Inf" overflow bucket.
const bucketCounts = new Array<number>(HTTP_DURATION_BUCKETS_MS.length + 1).fill(0);
let histogramCount = 0;
let histogramSum = 0;

export function observeDuration(ms: number): void {
  const index = HTTP_DURATION_BUCKETS_MS.findIndex((bound) => ms <= bound);
  bucketCounts[index === -1 ? HTTP_DURATION_BUCKETS_MS.length : index] += 1;
  histogramCount += 1;
  histogramSum += ms;
}

/**
 * Histogram percentile estimate: the upper bound of the first bucket whose
 * cumulative count reaches q*total (standard Prometheus-style estimation; the
 * overflow bucket estimates at the highest finite bound). Null when empty.
 */
function percentileAt(quantile: number): number | null {
  if (histogramCount === 0) return null;
  const target = quantile * histogramCount;
  let cumulative = 0;
  for (let i = 0; i < HTTP_DURATION_BUCKETS_MS.length; i++) {
    cumulative += bucketCounts[i];
    if (cumulative >= target) return HTTP_DURATION_BUCKETS_MS[i];
  }
  return HTTP_DURATION_BUCKETS_MS[HTTP_DURATION_BUCKETS_MS.length - 1];
}

// --- rolling request window + event buffers ---------------------------------

const httpRequestWindow: RequestSample[] = [];
const webhookSignatureFailures: number[] = [];
const jobFailures: JobFailureSample[] = [];

function pushBounded<T>(buffer: T[], item: T, cap: number): void {
  buffer.push(item);
  if (buffer.length > cap) buffer.shift();
}

// --- named recorders (the only call sites routes/services should use) -------

export function statusClass(status: number): StatusClass {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}

/** One finished HTTP request: counter + duration + rolling window. */
export function recordHttpRequest(status: number, durationMs: number): void {
  incCounter("http_requests_total", { status_class: statusClass(status) });
  if (status >= 500) incCounter("http_errors_total");
  observeDuration(durationMs);
  pushBounded(httpRequestWindow, { status, durationMs }, HTTP_REQUEST_WINDOW_SIZE);
}

/** Time-bucketed rate-limit rejections (generic surface, e.g. contact form). */
export function recordRateLimited(namespace: string): void {
  incCounter("http_rate_limited_total", { namespace });
}

/** Auth-abuse signal: sensitive auth endpoints rejecting with 429. */
export function recordAuthRateLimited(action: string): void {
  incCounter("auth_rate_limited_total", { action });
}

export function recordWebhookEvent(status: "processed" | "failed" | "ignored" | "received"): void {
  incCounter("webhook_events_total", { status });
}

export function recordWebhookSignatureFailure(): void {
  incCounter("webhook_signature_failures_total");
  pushBounded(webhookSignatureFailures, clockImpl(), EVENT_BUFFER_SIZE);
}

export function recordOutboxEvent(status: "claimed" | "completed" | "failed"): void {
  incCounter("outbox_events_total", { status });
}

export function recordEmailSent(outcome: "sent" | "suppressed" | "failed"): void {
  incCounter("email_sent_total", { outcome });
}

export function recordPaymentApiCall(outcome: "ok" | "error"): void {
  incCounter("payment_api_calls_total", { outcome });
}

/**
 * R2/presign failures. NOTE: no R2/presign server code exists yet (certificates
 * render PDFs in-process), so nothing increments this today — the recorder is
 * exported for the future upload path.
 */
export function recordR2Failure(): void {
  incCounter("r2_failures_total");
}

export function recordJobFailure(name: string): void {
  incCounter("job_failures_total", { name });
  pushBounded(jobFailures, { name, atMs: clockImpl() }, EVENT_BUFFER_SIZE);
}

// --- generic op wrapper ------------------------------------------------------

/**
 * Wraps a promise-returning operation with an outcome-labelled counter.
 * `outcome` may derive a success label from the resolved value; any throw
 * records outcome="error" and rethrows.
 */
export async function withMetrics<T>(
  name: string,
  fn: () => Promise<T>,
  options?: { labels?: Labels; outcome?: (value: T) => string },
): Promise<T> {
  try {
    const value = await fn();
    incCounter(name, { ...options?.labels, outcome: options?.outcome ? options.outcome(value) : "ok" });
    return value;
  } catch (error) {
    incCounter(name, { ...options?.labels, outcome: "error" });
    throw error;
  }
}

// --- alert evaluation (pure) -------------------------------------------------

export interface AlertWindowInput {
  /** Scraped gauge; null/undefined means "unknown" (skip the alert). */
  outboxOldestPendingAgeSeconds?: number | null;
  now?: number;
}

/**
 * Rolling-window alert rules, evaluated from in-memory buffers:
 *  - 5xx rate > 5% over the last 500 requests (min 20 samples);
 *  - >= 5 webhook signature failures within the 15-minute event window;
 *  - outbox oldest pending age > 300s (gauge passed in by the scrape);
 *  - > 10 job failures within the 15-minute event window.
 */
export function evaluateAlerts(input: AlertWindowInput = {}): MetricAlert[] {
  const now = input.now ?? clockImpl();
  const alerts: MetricAlert[] = [];

  if (httpRequestWindow.length >= HTTP_ERROR_RATE_MIN_WINDOW) {
    const errors = httpRequestWindow.filter((sample) => sample.status >= 500).length;
    const rate = errors / httpRequestWindow.length;
    if (rate > HTTP_ERROR_RATE_THRESHOLD) {
      alerts.push({
        name: "http_5xx_error_rate",
        value: rate,
        threshold: HTTP_ERROR_RATE_THRESHOLD,
        message: `${Math.round(rate * 100)}% of the last ${httpRequestWindow.length} requests returned 5xx (threshold ${HTTP_ERROR_RATE_THRESHOLD * 100}%).`,
      });
    }
  }

  const recentSignatureFailures = webhookSignatureFailures.filter((atMs) => now - atMs <= EVENT_ALERT_WINDOW_MS).length;
  if (recentSignatureFailures >= WEBHOOK_SIGNATURE_FAILURE_THRESHOLD) {
    alerts.push({
      name: "webhook_signature_failures",
      value: recentSignatureFailures,
      threshold: WEBHOOK_SIGNATURE_FAILURE_THRESHOLD,
      message: `${recentSignatureFailures} webhook signature failures in the last ${EVENT_ALERT_WINDOW_MS / 60_000} minutes — possible forged deliveries or a misconfigured webhook hash.`,
    });
  }

  const outboxAge = input.outboxOldestPendingAgeSeconds;
  if (outboxAge != null && outboxAge > OUTBOX_LAG_ALERT_THRESHOLD_SECONDS) {
    alerts.push({
      name: "outbox_oldest_pending_age_seconds",
      value: outboxAge,
      threshold: OUTBOX_LAG_ALERT_THRESHOLD_SECONDS,
      message: `Oldest pending outbox event is ${Math.round(outboxAge)}s old — the dispatcher is not draining (no cron/trigger running?).`,
    });
  }

  const recentJobFailures = jobFailures.filter((failure) => now - failure.atMs <= EVENT_ALERT_WINDOW_MS).length;
  if (recentJobFailures > JOB_FAILURE_ALERT_THRESHOLD) {
    alerts.push({
      name: "job_failures",
      value: recentJobFailures,
      threshold: JOB_FAILURE_ALERT_THRESHOLD,
      message: `${recentJobFailures} job failures in the last ${EVENT_ALERT_WINDOW_MS / 60_000} minutes (threshold ${JOB_FAILURE_ALERT_THRESHOLD}).`,
    });
  }

  return alerts;
}

// --- snapshot ---------------------------------------------------------------

export interface HistogramSnapshot {
  name: "http_request_duration_ms";
  unit: "ms";
  buckets: Array<{ le: number; count: number }>;
  count: number;
  sum: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
}

export interface MetricsSnapshot {
  release: ReturnType<typeof getReleaseInfo>;
  generatedAt: string;
  counters: Record<string, number>;
  histogram: HistogramSnapshot;
  gauges: Record<string, number | null>;
}

/**
 * Point-in-time JSON snapshot. `gauges` are scrape-time values supplied by the
 * caller (metrics.snapshot.ts adds the DB-scraped queue lag gauges); process
 * gauges are always included.
 */
export function snapshotJson(gauges: Record<string, number | null> = {}): MetricsSnapshot {
  const release = getReleaseInfo();
  return {
    release,
    generatedAt: new Date(clockImpl()).toISOString(),
    counters: countersJson(),
    histogram: {
      name: "http_request_duration_ms",
      unit: "ms",
      buckets: HTTP_DURATION_BUCKETS_MS.map((le, index) => ({ le, count: bucketCounts[index] })),
      count: histogramCount,
      sum: histogramSum,
      p50: percentileAt(0.5),
      p90: percentileAt(0.9),
      p99: percentileAt(0.99),
    },
    gauges: {
      process_uptime_seconds: Math.max(0, (clockImpl() - release.startedAtMs) / 1000),
      process_memory_heap_bytes: process.memoryUsage().heapUsed,
      ...gauges,
    },
  };
}

/** Test seam: wipe every registry buffer, counter and clock override. */
export function resetMetricsForTests(): void {
  counters.clear();
  bucketCounts.fill(0);
  histogramCount = 0;
  histogramSum = 0;
  httpRequestWindow.length = 0;
  webhookSignatureFailures.length = 0;
  jobFailures.length = 0;
  clockImpl = () => Date.now();
}
