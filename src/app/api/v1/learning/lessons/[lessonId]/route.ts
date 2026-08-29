import { lessonIdParamSchema } from "@/contracts/learning";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { ApiError, validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { getLessonAccess } from "@/server/modules/learning/lesson-access.service";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { lessonId } = await params;
    const parsedLessonId = parsePathParam(lessonIdParamSchema, lessonId);

    // Explicit anonymous fallback: lesson previews must be readable without a
    // session (the course page links here for signed-out visitors), so a 401
    // from the session lookup downgrades to userId = null and the access
    // matrix decides between PREVIEW and NONE. Any other auth failure still
    // propagates.
    let userId: string | null = null;
    try {
      const { user } = await requireAuthenticatedUser(request.headers);
      userId = user.id;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }

    return apiSuccess(context, await getLessonAccess(userId, parsedLessonId));
  });
}
