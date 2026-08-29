import { z } from "zod";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { getOrderStatusForUser } from "@/server/modules/payments/reconciliation.service";

// Order status read model for the recoverable pending state: the course page
// polls this after the hosted-checkout redirect instead of trusting the client.
export async function GET(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { orderId } = await params;
    parsePathParam(z.uuid(), orderId);
    const order = await getOrderStatusForUser(user.id, orderId);
    return apiSuccess(context, { order });
  });
}
