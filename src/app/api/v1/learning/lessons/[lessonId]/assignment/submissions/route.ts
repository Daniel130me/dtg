import { submissionCreateSchema } from "@/contracts/assessments";
import { lessonIdParamSchema } from "@/contracts/learning";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { createSubmission } from "@/server/modules/assessments/submissions.service";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

// Record a submission: deadline and resubmission policy are enforced server
// side (the learner view's canSubmit hint mirrors the same decision), and the
// created row comes back with latestGrade null.

export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { lessonId } = await params;
    const input = await parseJsonBody(request, submissionCreateSchema);
    return apiSuccess(
      context,
      await createSubmission(
        user.id,
        parsePathParam(lessonIdParamSchema, lessonId),
        input,
        context.requestId,
      ),
      201,
    );
  });
}
