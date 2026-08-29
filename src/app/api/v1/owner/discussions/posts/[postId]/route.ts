import { moderationUpdateSchema, postIdParamSchema } from "@/contracts/learning";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { setPostStatus } from "@/server/modules/learning/discussions.service";
import { parseJsonBody } from "@/server/http/validation";

interface RouteParams {
  params: Promise<{ postId: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { postId } = await params;
    const input = await parseJsonBody(request, moderationUpdateSchema);
    return apiSuccess(
      context,
      await setPostStatus(owner.id, parsePathParam(postIdParamSchema, postId), input.status, context.requestId),
    );
  });
}
