import { replyCreateSchema, threadIdParamSchema } from "@/contracts/learning";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { replyAsOwner } from "@/server/modules/learning/discussions.service";
import { parseJsonBody } from "@/server/http/validation";

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

/**
 * POST /api/v1/owner/discussions/threads/{threadId}/replies — answer a
 * student's question as the owner. Same outbox path as learner replies, so
 * the thread author is notified.
 */
export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { threadId } = await params;
    const input = await parseJsonBody(request, replyCreateSchema);
    return apiSuccess(
      context,
      await replyAsOwner(owner.id, parsePathParam(threadIdParamSchema, threadId), input, context.requestId),
      201,
    );
  });
}
