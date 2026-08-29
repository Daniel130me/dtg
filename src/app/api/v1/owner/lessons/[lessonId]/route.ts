import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { deleteLesson, updateLesson } from "@/server/modules/courses/curriculum.service";
import {
  lessonIdParamSchema,
  lessonUpdateSchema,
  parsePathParam,
} from "@/server/modules/courses/courses.schemas";

interface RouteParams {
  params: Promise<{ lessonId: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { lessonId } = await params;
    const input = await parseJsonBody(request, lessonUpdateSchema);
    const result = await updateLesson(parsePathParam(lessonIdParamSchema, lessonId), input);
    return apiSuccess(context, result);
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { lessonId } = await params;
    const deleted = await deleteLesson(parsePathParam(lessonIdParamSchema, lessonId));
    return apiSuccess(context, { deleted: true, ...deleted });
  });
}
