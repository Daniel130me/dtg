import { z } from "zod";
import { reviewStatusParamSchema } from "@/contracts/reviews";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { setReviewStatus } from "@/server/modules/reviews/reviews.service";
import { parseJsonBody } from "@/server/http/validation";

interface RouteParams {
  params: Promise<{ reviewId: string }>;
}

// The moderation body is {status} over the shared status enum.
const statusBodySchema = z.object({ status: reviewStatusParamSchema });

export async function PUT(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { reviewId } = await params;
    const input = await parseJsonBody(request, statusBodySchema);
    return apiSuccess(
      context,
      await setReviewStatus(
        owner.id,
        parsePathParam(z.uuid(), reviewId),
        input.status,
        context.requestId,
      ),
    );
  });
}
