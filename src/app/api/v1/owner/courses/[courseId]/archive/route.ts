import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { archiveCourse } from "@/server/modules/courses/courses.service";
import { courseIdParamSchema, parsePathParam } from "@/server/modules/courses/courses.schemas";

export async function POST(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { courseId } = await params;
    const course = await archiveCourse(owner.id, parsePathParam(courseIdParamSchema, courseId), context.requestId);
    return apiSuccess(context, { course });
  });
}
