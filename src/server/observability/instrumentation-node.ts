import type { Instrumentation } from "next";
import { captureError } from "@/server/observability/error-monitor";
import { beginShutdown, isShuttingDown } from "@/server/resilience/shutdown";

const SHUTDOWN_GRACE_MS = 2_000;
const GLOBAL_FLAG = "__dtgObservabilityRegistered";

interface GlobalRegistrationFlag {
  [GLOBAL_FLAG]?: boolean;
}

/** Installs process handlers once, including when development HMR reloads. */
export function registerNodeInstrumentation(): void {
  const globalScope = globalThis as GlobalRegistrationFlag;
  if (globalScope[GLOBAL_FLAG]) return;
  globalScope[GLOBAL_FLAG] = true;

  process.on("uncaughtException", (error: unknown) => {
    captureError(error, { extra: { source: "uncaughtException" } });
    process.exitCode = 1;
  });

  process.on("unhandledRejection", (reason: unknown) => {
    captureError(reason, { extra: { source: "unhandledRejection" } });
  });

  const handleSignal = (signal: "SIGTERM" | "SIGINT"): void => {
    if (isShuttingDown()) return;
    beginShutdown(signal);
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
  };

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}

/** Captures a Next.js server request failure with route-level context. */
export function captureNodeRequestError(
  error: Parameters<Instrumentation.onRequestError>[0],
  request: Parameters<Instrumentation.onRequestError>[1],
  context: Parameters<Instrumentation.onRequestError>[2],
): void {
  captureError(error, {
    route: context.routePath,
    extra: {
      source: "onRequestError",
      method: request.method,
      routeType: context.routeType,
      routerKind: context.routerKind,
    },
  });
}
