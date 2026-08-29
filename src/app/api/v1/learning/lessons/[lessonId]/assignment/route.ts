import { lessonIdParamSchema } from "@/contracts/learning";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { getAssignmentLearnerView } from "@/server/modules/assessments/submissions.service";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

// Learner assignment view: the brief plus the caller's submissions (ascending,
// latest grade per row) and the canSubmit hint from the shared policy.

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { lessonId } = await params;
    return apiSuccess(
      context,
      await getAssignmentLearnerView(user.id, parsePathParam(lessonIdParamSchema, lessonId)),
    );
  });
}
