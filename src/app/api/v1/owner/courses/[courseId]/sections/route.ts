import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { createSection } from "@/server/modules/courses/curriculum.service";
import {
  courseIdParamSchema,
  parsePathParam,
  sectionCreateSchema,
} from "@/server/modules/courses/courses.schemas";

export async function POST(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { courseId } = await params;
    const input = await parseJsonBody(request, sectionCreateSchema);
    const result = await createSection(parsePathParam(courseIdParamSchema, courseId), input);
    return apiSuccess(context, result, 201);
  });
}
