import { submissionIdParamSchema } from "@/contracts/assessments";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { getGradingDetail } from "@/server/modules/assessments/submissions.service";

interface RouteParams {
  params: Promise<{ submissionId: string }>;
}

// Owner grading detail: the submission, its assignment/lesson/course context
// and the full ascending grade history, in one query.

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { submissionId } = await params;
    return apiSuccess(
      context,
      await getGradingDetail(parsePathParam(submissionIdParamSchema, submissionId)),
    );
  });
}
