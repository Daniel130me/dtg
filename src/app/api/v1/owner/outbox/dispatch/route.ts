import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { dispatchPendingOutbox } from "@/server/modules/notifications/outbox.dispatcher";

// Owner-triggered dispatcher sweep: one explicit drain of pending outbox
// events (notification projections + transactional emails). Per-event
// failures are retried/backoff-scheduled inside the dispatcher and only
// aggregated here — the route itself never 500s on a poison event.
const OWNER_DISPATCH_LIMIT = 50;

export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const result = await dispatchPendingOutbox({ limit: OWNER_DISPATCH_LIMIT });
    return apiSuccess(context, result);
  });
}
