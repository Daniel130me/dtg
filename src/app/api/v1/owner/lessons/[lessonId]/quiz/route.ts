import { quizAuthoringInputSchema } from "@/contracts/assessments";
import { lessonIdParamSchema } from "@/contracts/learning";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import {
  deleteQuizAuthoring,
  getQuizAuthoring,
  putQuizAuthoring,
} from "@/server/modules/assessments/authoring.service";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

// The authoring singleton contract: every verb answers 200 with
// `{ quiz: QuizAuthoringDto | null }` — `null` when the lesson has no quiz yet
// (GET) or after a delete (DELETE is idempotent). PUT replaces the whole quiz
// transactionally (version bump, fresh question ids).

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { lessonId } = await params;
    return apiSuccess(
      context,
      await getQuizAuthoring(parsePathParam(lessonIdParamSchema, lessonId)),
    );
  });
}

export async function PUT(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { lessonId } = await params;
    const input = await parseJsonBody(request, quizAuthoringInputSchema);
    return apiSuccess(
      context,
      await putQuizAuthoring(
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
      await deleteQuizAuthoring(
        owner.id,
        parsePathParam(lessonIdParamSchema, lessonId),
        context.requestId,
      ),
    );
  });
}
