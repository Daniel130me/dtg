import { assignmentAuthoringInputSchema } from "@/contracts/assessments";
import { lessonIdParamSchema } from "@/contracts/learning";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import {
  deleteAssignmentAuthoring,
  getAssignmentAuthoring,
  putAssignmentAuthoring,
} from "@/server/modules/assessments/authoring.service";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

// The authoring singleton contract (mirrors the quiz route): every verb
// answers 200 with `{ assignment: AssignmentAuthoringDto | null }` — `null`
// when the lesson has no brief yet (GET) or after an idempotent delete.
// `dueAt` arrives as an ISO string per the contract and is stored as a Date.

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { lessonId } = await params;
    return apiSuccess(
      context,
      await getAssignmentAuthoring(parsePathParam(lessonIdParamSchema, lessonId)),
    );
  });
}

export async function PUT(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { lessonId } = await params;
    const input = await parseJsonBody(request, assignmentAuthoringInputSchema);
    return apiSuccess(
      context,
      await putAssignmentAuthoring(
        owner.id,
        parsePathParam(lessonIdParamSchema, lessonId),
        input,
        context.requestId,
      ),
    );
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { lessonId } = await params;
    return apiSuccess(
      context,
      await deleteAssignmentAuthoring(
        owner.id,
        parsePathParam(lessonIdParamSchema, lessonId),
        context.requestId,
      ),
    );
  });
}
