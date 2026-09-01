import { db } from "@/server/db/client";
import { requireOwner } from "@/server/auth/authorization";
import { getServerEnv } from "@/server/config/env";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { collectQueueGauges } from "@/server/observability/metrics.snapshot";
import { getReleaseInfo } from "@/server/observability/release";
import { getConfiguredPaymentProvider } from "@/server/modules/payments/provider";
import { withTimeout } from "@/server/resilience/timeout";

// Owner-only deep diagnostics. Configuration probes are env-only (no network
// calls); the database probe is a timed SELECT 1 bounded by the readiness
// timeout. migrationsPending is deliberately OMITTED: an honest pending-
// migrations check needs a migrations-table diff that is not worth the extra
// per-request cost here (see `prisma migrate status` in the runbooks instead).
async function probeDatabase(): Promise<{ available: boolean; latencyMs: number | null }> {
  const startedAtMs = Date.now();
  try {
    await withTimeout(
      getServerEnv().DB_READINESS_TIMEOUT_MS,
      "diagnostics.database",
      () => db.$queryRaw`SELECT 1`,
    );
    return { available: true, latencyMs: Date.now() - startedAtMs };
  } catch {
    return { available: false, latencyMs: null };
  }
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const env = getServerEnv();
    const [database, queues] = await Promise.all([probeDatabase(), collectQueueGauges()]);
    const release = getReleaseInfo();

    return apiSuccess(context, {
      database,
      providers: {
        smtpConfigured: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.EMAIL_FROM),
        r2Configured: Boolean(
          env.R2_BUCKET &&
            env.R2_S3_ENDPOINT &&
            (env.R2_PUBLIC_BASE_URL ?? env.R2_ENDPOINT) &&
            env.R2_ACCESS_KEY_ID &&
            env.R2_SECRET_ACCESS_KEY,
        ),
        paymentsConfigured: getConfiguredPaymentProvider() !== null,
      },
      queues: {
        outboxOldestPendingAgeSeconds: queues.outboxOldestPendingAgeSeconds,
        webhookOldestUnprocessedAgeSeconds: queues.webhookOldestUnprocessedAgeSeconds,
      },
      process: {
        uptimeSeconds: release.uptimeSeconds,
        heapUsedBytes: process.memoryUsage().heapUsed,
        release,
      },
    });
  });
}
