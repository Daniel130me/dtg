import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { moveLesson } from "@/server/modules/courses/curriculum.service";
import {
  lessonIdParamSchema,
  moveLessonSchema,
  parsePathParam,
} from "@/server/modules/courses/courses.schemas";

export async function POST(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { lessonId } = await params;
    const input = await parseJsonBody(request, moveLessonSchema);
    const result = await moveLesson(parsePathParam(lessonIdParamSchema, lessonId), input);
    return apiSuccess(context, result);
  });
}
