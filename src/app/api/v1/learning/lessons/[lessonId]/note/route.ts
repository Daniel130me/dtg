import { lessonIdParamSchema, noteUpsertSchema } from "@/contracts/learning";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import {
  deleteMyNote,
  getMyNote,
  saveMyNote,
} from "@/server/modules/learning/notes.service";
import { parseJsonBody } from "@/server/http/validation";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { lessonId } = await params;
    return apiSuccess(context, await getMyNote(user.id, parsePathParam(lessonIdParamSchema, lessonId)));
  });
}

export async function PUT(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { lessonId } = await params;
    const input = await parseJsonBody(request, noteUpsertSchema);
    return apiSuccess(
      context,
      await saveMyNote(user.id, parsePathParam(lessonIdParamSchema, lessonId), input),
    );
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { lessonId } = await params;
    return apiSuccess(
      context,
      await deleteMyNote(user.id, parsePathParam(lessonIdParamSchema, lessonId)),
    );
  });
}
