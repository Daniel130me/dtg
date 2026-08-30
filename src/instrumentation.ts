import { captureError } from "@/server/observability/error-monitor";
import { beginShutdown, isShuttingDown } from "@/server/resilience/shutdown";

// ---------------------------------------------------------------------------
// Next.js instrumentation hook (Phase 12 items 1 + 6).
//
// Next 16 picks up src/instrumentation.ts automatically and calls register()
// once per server boot. This file is the ONLY place that touches process-level
// signal handlers:
//   - uncaughtException   -> captureError + log, then exitCode = 1 (no hard
//                            exit; in-flight requests may finish draining).
//   - unhandledRejection  -> captureError + log, DO NOT exit (a stray rejected
//                            promise must not kill the server).
//   - SIGTERM / SIGINT    -> beginShutdown (flips the drain flag so
//                            health/live reports it) and exit(0) after a short
//                            grace window. Double signals are ignored.
//
// Dev HMR can evaluate this module more than once, so registration is guarded
// by a globalThis flag.
// ---------------------------------------------------------------------------

const SHUTDOWN_GRACE_MS = 2_000;
const GLOBAL_FLAG = "__dtgObservabilityRegistered";

interface GlobalRegistrationFlag {
  [GLOBAL_FLAG]?: boolean;
}

export async function register(): Promise<void> {
  const globalScope = globalThis as GlobalRegistrationFlag;
  if (globalScope[GLOBAL_FLAG]) return;
  globalScope[GLOBAL_FLAG] = true;

  installProcessErrorHandlers();
  installShutdownHandlers();
}

function installProcessErrorHandlers(): void {
  process.on("uncaughtException", (error: unknown) => {
    captureError(error, { extra: { source: "uncaughtException" } });
    // Signal the runtime to exit once the loop drains, without killing
    // in-flight work mid-request.
    process.exitCode = 1;
  });

  process.on("unhandledRejection", (reason: unknown) => {
    captureError(reason, { extra: { source: "unhandledRejection" } });
    // Deliberately no exit: unhandled rejections are a code smell, not a
    // process-fatal condition (Node's default throw would take the server down).
  });
}

function installShutdownHandlers(): void {
  const handleSignal = (signal: "SIGTERM" | "SIGINT"): void => {
    // Second signal during the grace window must not restart the timer or log
    // twice — just keep draining.
    if (isShuttingDown()) return;
    beginShutdown(signal);
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
  };

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}

/**
 * Next.js server-side error hook. Signature per Next 16:
 * onRequestError(request: Request, error: unknown, context: ErrorContext).
 * `digest` ties the error to the request log; routePath identifies the route.
 */
export function onRequestError(
  request: Request,
  error: unknown,
  context: { digest?: string; routePath?: string },
): void {
  void request;
  captureError(error, {
    route: context?.routePath,
    extra: {
      source: "onRequestError",
      ...(context?.digest !== undefined ? { digest: context.digest } : {}),
    },
  });
}
