import { z } from "zod";
import { reviewReplySchema } from "@/contracts/reviews";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { replyToReview } from "@/server/modules/reviews/reviews.service";
import { parseJsonBody } from "@/server/http/validation";

interface RouteParams {
  params: Promise<{ reviewId: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { reviewId } = await params;
    const input = await parseJsonBody(request, reviewReplySchema);
    return apiSuccess(
      context,
      await replyToReview(
        owner.id,
        parsePathParam(z.uuid(), reviewId),
        input.reply,
        context.requestId,
      ),
    );
  });
}
