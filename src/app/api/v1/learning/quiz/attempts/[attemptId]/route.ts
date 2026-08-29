import { quizAttemptIdParamSchema } from "@/contracts/assessments";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { getQuizAttemptResult } from "@/server/modules/assessments/attempts.service";

interface RouteParams {
  params: Promise<{ attemptId: string }>;
}

// Post-submission review: per-question correctness and explanations, rebuilt
// from the attempt's frozen snapshot. Only the owner of the attempt can read
// it; a STARTED attempt answers 422 (not submitted yet).

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { attemptId } = await params;
    return apiSuccess(
      context,
      await getQuizAttemptResult(user.id, parsePathParam(quizAttemptIdParamSchema, attemptId)),
    );
  });
}
