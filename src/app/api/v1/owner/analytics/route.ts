import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { getOwnerAnalytics } from "@/server/modules/analytics/analytics.service";

// Owner analytics dashboard: one cached read-model payload (60s in-process
// TTL; docs/ANALYTICS_METRICS.md). No query params — the payload shape is
// fixed by src/contracts/analytics.ts. requireOwner performs the session,
// role, and platform-ownership checks before the service runs; the service
// trusts the caller because every metric is platform-wide.

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    return apiSuccess(context, await getOwnerAnalytics());
  });
}
