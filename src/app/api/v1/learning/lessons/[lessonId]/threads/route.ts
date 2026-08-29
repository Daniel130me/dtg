import { lessonIdParamSchema, threadCreateSchema, threadListQuerySchema } from "@/contracts/learning";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import {
  createThread,
  listLessonThreads,
} from "@/server/modules/learning/discussions.service";
import { parseJsonBody } from "@/server/http/validation";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

function searchParamsToObject(url: URL): Record<string, string> {
  // Empty strings are dropped so omitted params fall back to schema defaults
  // (mirrors the enrolments list route).
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { lessonId } = await params;
    const query = threadListQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
    if (!query.success) throw validationError(query.error);
    return apiSuccess(
      context,
      await listLessonThreads(user.id, parsePathParam(lessonIdParamSchema, lessonId), query.data),
    );
  });
}

export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { lessonId } = await params;
    const input = await parseJsonBody(request, threadCreateSchema);
    return apiSuccess(
      context,
      await createThread(user.id, parsePathParam(lessonIdParamSchema, lessonId), input, context.requestId),
      201,
    );
  });
}
