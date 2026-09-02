import { submissionIdParamSchema, submissionReturnSchema } from "@/contracts/assessments";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { returnSubmission } from "@/server/modules/assessments/submissions.service";

interface RouteParams {
  params: Promise<{ submissionId: string }>;
}

// Return a submission for revision: flips it to RETURNED with the owner's
// feedback and fans out one assignment.returned outbox event. The learner
// answers with a fresh attempt per the resubmission policy.
export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { submissionId } = await params;
    const input = await parseJsonBody(request, submissionReturnSchema);
    return apiSuccess(
      context,
      await returnSubmission(
        owner.id,
        parsePathParam(submissionIdParamSchema, submissionId),
        input,
        context.requestId,
      ),
    );
  });
}
