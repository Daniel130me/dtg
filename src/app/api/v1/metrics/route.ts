import { requireOwner } from "@/server/auth/authorization";
import { getServerEnv } from "@/server/config/env";
import { ApiError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { buildMetricsReport } from "@/server/observability/metrics.snapshot";

// Owner-only in-process metrics: registry snapshot (counters, request-duration
// histogram, queue-lag gauges) plus rolling-window alert evaluation. Exposure
// is gated by METRICS_ENABLED (collection itself stays on — it is cheap and
// losing history on a toggle flip would hurt incident analysis).
export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    if (!getServerEnv().METRICS_ENABLED) {
      throw new ApiError(404, "METRICS_DISABLED", "Metrics are not enabled on this deployment.");
    }
    const { metrics, alerts } = await buildMetricsReport();
    return apiSuccess(context, { metrics, alerts });
  });
}
