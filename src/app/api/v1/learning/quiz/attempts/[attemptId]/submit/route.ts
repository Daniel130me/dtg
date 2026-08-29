import { quizAttemptIdParamSchema, quizSubmitSchema } from "@/contracts/assessments";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { submitQuizAttempt } from "@/server/modules/assessments/attempts.service";

interface RouteParams {
  params: Promise<{ attemptId: string }>;
}

// Submit a STARTED attempt: scored server-side from the frozen snapshot and
// answered with the full review payload. The transition is atomic — double
// submits and expired windows both answer 422.

export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { attemptId } = await params;
    const input = await parseJsonBody(request, quizSubmitSchema);
    return apiSuccess(
      context,
      await submitQuizAttempt(
        user.id,
        parsePathParam(quizAttemptIdParamSchema, attemptId),
        input,
        context.requestId,
      ),
    );
  });
}
