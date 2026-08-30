import type { RequestContext } from "@/server/http/request-context";
import { logger } from "@/server/observability/logger";

// ---------------------------------------------------------------------------
// Minimal request-scoped span logging (Phase 12 tracing seam).
//
// Deliberately dependency-free: one structured log line per span instead of an
// OTel collector (the collector/SDK attachment point is documented in the
// Phase 12 runbooks — swapping this file for a real tracer keeps the call
// sites unchanged). Spans are only applied at meaningful external boundaries
// (db ping, email send, payment HTTP, outbox batch), never per DB call.
//
// NOTE: `attrs` is spread at log time, so a span body may mutate it (e.g. set
// an outcome/permanent flag) before the line is emitted.
// ---------------------------------------------------------------------------

export type SpanAttrs = Record<string, unknown>;

export async function withSpan<T>(name: string, attrs: SpanAttrs | undefined, fn: () => Promise<T> | T): Promise<T> {
  const startedAtMs = Date.now();
  try {
    const result = await fn();
    logger.info("span", { span: name, durationMs: Date.now() - startedAtMs, status: "ok", ...(attrs ?? {}) });
    return result;
  } catch (error) {
    logger.info("span", { span: name, durationMs: Date.now() - startedAtMs, status: "error", ...(attrs ?? {}), error });
    throw error;
  }
}

/** Span that carries the request id so traces correlate with request logs. */
export async function spanFromContext<T>(
  name: string,
  context: RequestContext,
  fn: () => Promise<T> | T,
  attrs?: SpanAttrs,
): Promise<T> {
  return withSpan(name, { ...(attrs ?? {}), requestId: context.requestId }, fn);
}
