import { db } from "@/server/db/client";
import { withDatabaseConnectionRetry } from "@/server/db/retry";
import { getServerEnv } from "@/server/config/env";
import { ApiError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { spanFromContext } from "@/server/observability/trace";

async function assertDatabaseReady(): Promise<void> {
  const { DB_READINESS_TIMEOUT_MS } = getServerEnv();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new ApiError(503, "DATABASE_UNAVAILABLE", "A required dependency is unavailable.")),
      DB_READINESS_TIMEOUT_MS,
    );
  });

  try {
    await Promise.race([
      withDatabaseConnectionRetry(() => db.$queryRaw`SELECT 1`),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    // The hand-rolled Promise.race timeout is kept as-is (identical 503
    // semantics); the span only adds an observability line ("db.ping").
    try {
      await spanFromContext("db.ping", context, () => assertDatabaseReady());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "DATABASE_UNAVAILABLE", "A required dependency is unavailable.");
    }
    return apiSuccess(context, { status: "ready", database: "available" });
  });
}
