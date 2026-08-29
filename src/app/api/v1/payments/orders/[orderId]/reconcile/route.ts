import { z } from "zod";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { reconcileOrderRequestSchema } from "@/contracts/payments";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { reconcileOrderForUser } from "@/server/modules/payments/reconciliation.service";

// Reconcile endpoint for the hosted-checkout return trip: verifies the charge
// server-side and fulfils the order when the provider confirms it, then always
// answers with the fresh order status.
export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { orderId } = await params;
    parsePathParam(z.uuid(), orderId);
    const input = await parseJsonBody(request, reconcileOrderRequestSchema);
    const order = await reconcileOrderForUser(user.id, orderId, input, context.requestId);
    return apiSuccess(context, { order });
  });
}
