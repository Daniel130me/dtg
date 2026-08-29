import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { createLesson } from "@/server/modules/courses/curriculum.service";
import {
  lessonCreateSchema,
  parsePathParam,
  sectionIdParamSchema,
} from "@/server/modules/courses/courses.schemas";

export async function POST(request: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { sectionId } = await params;
    const input = await parseJsonBody(request, lessonCreateSchema);
    const result = await createLesson(parsePathParam(sectionIdParamSchema, sectionId), input);
    return apiSuccess(context, result, 201);
  });
}
