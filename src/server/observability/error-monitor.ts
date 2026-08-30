import { createHash } from "node:crypto";
import { logger } from "@/server/observability/logger";
import { redactLogValue } from "@/server/observability/redact";
import { getReleaseInfo } from "@/server/observability/release";

// ---------------------------------------------------------------------------
// Application error monitor (Phase 12 item 1).
//
// captureError normalizes ANY thrown value (Error / string / object), enriches
// it with the release identity, applies the same key-pattern redaction as the
// structured logger, and emits one "Unhandled error" log line. Repeated errors
// are deduplicated through a bounded LRU (max 200 fingerprints of
// name+message): the first occurrence logs immediately, and re-log only on
// power-of-two counts (2, 4, 8, ...) so a hot repeating error surfaces with a
// visible occurrence count without flooding the log.
//
// NEVER throws: observability failures must not break request paths, so the
// whole body is guarded and the log sink is injectable for tests (the default
// sink goes through logger.error, which needs valid server env).
// ---------------------------------------------------------------------------

export interface CaptureContext {
  requestId?: string;
  route?: string;
  userId?: string;
  extra?: Record<string, unknown>;
}

export interface CapturedError {
  fingerprint: string;
  count: number;
  name: string;
  message: string;
}

export type ErrorSink = (message: string, context: Record<string, unknown>) => void;

const MAX_FINGERPRINTS = 200;
const FINGERPRINT_MESSAGE_MAX = 500;
const NORMALIZED_MESSAGE_MAX = 1000;

interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

const dedupe = new Map<string, number>();
let errorSink: ErrorSink = (message, context) => logger.error(message, context);

/** Test seam: replace the log sink (clears dedupe state as well). */
export function setErrorMonitorSinkForTests(sink: ErrorSink): void {
  errorSink = sink;
  flushErrorMonitorForTests();
}

/** Test seam: clear the fingerprint LRU. */
export function flushErrorMonitorForTests(): void {
  dedupe.clear();
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === "string") {
    return { name: "string", message: error };
  }
  // Objects/thrown non-Errors: render through redaction (values can still leak
  // credentials via toString) and truncate hard.
  const rendered = JSON.stringify(redactLogValue(error)) ?? String(error);
  return { name: "NonError", message: rendered.slice(0, NORMALIZED_MESSAGE_MAX) };
}

function fingerprintOf(normalized: NormalizedError): string {
  const raw = `${normalized.name}:${normalized.message.slice(0, FINGERPRINT_MESSAGE_MAX)}`;
  return createHash("sha256").update(raw).digest("hex");
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

export function captureError(error: unknown, context: CaptureContext = {}): CapturedError | undefined {
  try {
    const normalized = normalizeError(error);
    const fingerprint = fingerprintOf(normalized);

    // LRU refresh: re-inserting moves the fingerprint to the newest slot.
    const previousCount = dedupe.get(fingerprint);
    if (previousCount !== undefined) dedupe.delete(fingerprint);
    const count = (previousCount ?? 0) + 1;
    dedupe.set(fingerprint, count);
    while (dedupe.size > MAX_FINGERPRINTS) {
      const oldest = dedupe.keys().next().value;
      if (oldest === undefined) break;
      dedupe.delete(oldest);
    }

    if (count === 1 || isPowerOfTwo(count)) {
      const release = getReleaseInfo();
      const extra = context.extra ? (redactLogValue(context.extra) as Record<string, unknown>) : undefined;
      errorSink("Unhandled error", {
        ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
        ...(context.route !== undefined ? { route: context.route } : {}),
        ...(context.userId !== undefined ? { userId: context.userId } : {}),
        ...(extra ?? {}),
        error: {
          name: normalized.name,
          message: normalized.message,
          ...(normalized.stack !== undefined ? { stack: normalized.stack } : {}),
        },
        fingerprint,
        count,
        releaseId: release.releaseId,
        environment: release.environment,
      });
    }

    return { fingerprint, count, name: normalized.name, message: normalized.message };
  } catch {
    // The monitor itself failed (e.g. env misconfigured behind the logger) —
    // swallow: crashing a request path to report an error is worse.
    return undefined;
  }
}
