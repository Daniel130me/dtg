import { db } from "@/server/db/client";
import { getServerEnv } from "@/server/config/env";
import { ApiError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";

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
    await Promise.race([db.$queryRaw`SELECT 1`, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    try {
      await assertDatabaseReady();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "DATABASE_UNAVAILABLE", "A required dependency is unavailable.");
    }
    return apiSuccess(context, { status: "ready", database: "available" });
  });
}
