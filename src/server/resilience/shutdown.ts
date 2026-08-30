import { logger } from "@/server/observability/logger";

// ---------------------------------------------------------------------------
// Graceful-drain flag. The HTTP server itself is NOT closed here — Node/Next
// owns the listener. Flipping the flag is enough: health/live keeps answering
// 200 (so container orchestrators do not force-kill) but reports
// draining=true, and the process exits after a short grace window from the
// signal handler in src/instrumentation.ts.
// ---------------------------------------------------------------------------

let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Idempotent: a second signal (or a second caller) is a no-op. */
export function beginShutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn("Graceful shutdown started", { reason });
}
