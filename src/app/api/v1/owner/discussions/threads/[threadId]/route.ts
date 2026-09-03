import {
  moderationUpdateSchema,
  replyListQuerySchema,
  threadIdParamSchema,
} from "@/contracts/learning";
import { requireOwner } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { getOwnerThread, setThreadStatus } from "@/server/modules/learning/discussions.service";
import { parseJsonBody } from "@/server/http/validation";

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

function searchParamsToObject(url: URL): Record<string, string> {
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

/** GET — the full conversation (thread + all posts, hidden ones labelled). */
export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { threadId } = await params;
    const query = replyListQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
    if (!query.success) throw validationError(query.error);
    return apiSuccess(
      context,
      await getOwnerThread(parsePathParam(threadIdParamSchema, threadId), query.data),
    );
  });
}

/** PATCH — moderation status (hide/restore). */
export async function PATCH(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { threadId } = await params;
    const input = await parseJsonBody(request, moderationUpdateSchema);
    return apiSuccess(
      context,
      await setThreadStatus(owner.id, parsePathParam(threadIdParamSchema, threadId), input.status, context.requestId),
    );
  });
}
