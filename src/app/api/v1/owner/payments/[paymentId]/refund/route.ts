import { z } from "zod";
import { requireOwner } from "@/server/auth/authorization";
import { refundRequestSchema } from "@/contracts/payments";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { requestRefund } from "@/server/modules/payments/refunds.service";

// Owner-only refund request. Access revocation happens later, on the
// refund.completed webhook, because Flutterwave refunds are asynchronous.
export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { paymentId } = await params;
    parsePathParam(z.uuid(), paymentId);
    const input = await parseJsonBody(request, refundRequestSchema);
    const refund = await requestRefund(paymentId, input, owner.id, context.requestId);
    return apiSuccess(context, { refund });
  });
}
