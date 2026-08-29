import {
  LESSON_COMPLETION_MONOTONIC,
  lessonIdParamSchema,
  progressUpdateSchema,
} from "@/contracts/learning";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { ApiError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { markLessonCompleted } from "@/server/modules/learning/progress.service";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { lessonId } = await params;
    const parsedLessonId = parsePathParam(lessonIdParamSchema, lessonId);

    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      throw new ApiError(400, "INVALID_JSON", "The request body is not valid JSON.");
    }
    // The contract only accepts { completed: true } — completion is monotonic
    // and has no reverse path. A dedicated error code (instead of a generic
    // validation error) lets clients explain the rule.
    const parsed = progressUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        422,
        LESSON_COMPLETION_MONOTONIC,
        "Lesson completion is monotonic and cannot be reversed.",
      );
    }

    return apiSuccess(context, await markLessonCompleted(user.id, parsedLessonId, context.requestId));
  });
}
