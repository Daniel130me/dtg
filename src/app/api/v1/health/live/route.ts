import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { isShuttingDown } from "@/server/resilience/shutdown";

// Liveness probe. Always answers 200 while the process can serve — even during
// the graceful-drain window (load balancers keep routing; the `draining` field
// tells operators the process is exiting after its grace period).
export function GET(request: Request) {
  return executeRoute(request, (context) =>
    apiSuccess(context, { status: "ok", draining: isShuttingDown() }),
  );
}
