import { gradeCreateSchema, submissionIdParamSchema } from "@/contracts/assessments";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { gradeSubmission } from "@/server/modules/assessments/submissions.service";

interface RouteParams {
  params: Promise<{ submissionId: string }>;
}

// Record a grade: appended to the submission's history (re-grading appends,
// never conflicts), flips the submission to GRADED, and fans out one outbox
// event per grade row.

export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { submissionId } = await params;
    const input = await parseJsonBody(request, gradeCreateSchema);
    return apiSuccess(
      context,
      await gradeSubmission(
        owner.id,
        parsePathParam(submissionIdParamSchema, submissionId),
        input,
        context.requestId,
      ),
    );
  });
}
