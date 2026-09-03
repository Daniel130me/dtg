import type { Instrumentation } from "next";

/**
 * Keep the shared instrumentation entry Edge-compatible. The application's
 * database and observability stack are Node-only, so they are loaded only in
 * the Node.js runtime as recommended by Next.js 16.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNodeInstrumentation } = await import("@/server/observability/instrumentation-node");
  registerNodeInstrumentation();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureNodeRequestError } = await import("@/server/observability/instrumentation-node");
  captureNodeRequestError(error, request, context);
};
