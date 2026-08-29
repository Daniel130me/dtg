import { lessonIdParamSchema } from "@/contracts/learning";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { getQuizLearnerView } from "@/server/modules/assessments/attempts.service";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

// Learner quiz view: sanitized questions only (no isCorrect/explanation) plus
// the caller's attempt state. Requires a published lesson, an ACTIVE/COMPLETED
// enrolment, and an authored quiz.

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { lessonId } = await params;
    return apiSuccess(
      context,
      await getQuizLearnerView(user.id, parsePathParam(lessonIdParamSchema, lessonId)),
    );
  });
}
