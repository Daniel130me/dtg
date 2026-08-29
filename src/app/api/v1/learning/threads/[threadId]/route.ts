import { replyListQuerySchema, threadIdParamSchema } from "@/contracts/learning";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { getThread } from "@/server/modules/learning/discussions.service";

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

function searchParamsToObject(url: URL): Record<string, string> {
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { threadId } = await params;
    const query = replyListQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
    if (!query.success) throw validationError(query.error);
    return apiSuccess(
      context,
      await getThread(user.id, parsePathParam(threadIdParamSchema, threadId), query.data),
    );
  });
}
