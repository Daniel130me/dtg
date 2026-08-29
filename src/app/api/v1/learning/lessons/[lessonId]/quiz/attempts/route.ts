import { lessonIdParamSchema } from "@/contracts/learning";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { startQuizAttempt } from "@/server/modules/assessments/attempts.service";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

// Start (or resume) a quiz attempt: 201 with the active attempt carrying the
// sanitized snapshot questions. An in-flight attempt resumes transparently.

export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { lessonId } = await params;
    return apiSuccess(
      context,
      await startQuizAttempt(user.id, parsePathParam(lessonIdParamSchema, lessonId)),
      201,
    );
  });
}
