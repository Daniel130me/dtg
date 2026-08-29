import { replyCreateSchema, threadIdParamSchema } from "@/contracts/learning";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { replyToThread } from "@/server/modules/learning/discussions.service";
import { parseJsonBody } from "@/server/http/validation";

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { threadId } = await params;
    const input = await parseJsonBody(request, replyCreateSchema);
    return apiSuccess(
      context,
      await replyToThread(user.id, parsePathParam(threadIdParamSchema, threadId), input, context.requestId),
      201,
    );
  });
}
