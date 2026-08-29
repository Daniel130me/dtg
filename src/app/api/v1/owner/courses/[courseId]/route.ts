import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody, parseSearchParams } from "@/server/http/validation";
import {
  deleteCourse,
  getOwnerCourse,
  updateCourse,
} from "@/server/modules/courses/courses.service";
import {
  courseIdParamSchema,
  getOwnerCourseQuerySchema,
  parsePathParam,
  updateCourseSchema,
} from "@/server/modules/courses/courses.schemas";

interface RouteParams {
  params: Promise<{ courseId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { courseId } = await params;
    const query = parseSearchParams(new URL(request.url), getOwnerCourseQuerySchema);
    const course = await getOwnerCourse(parsePathParam(courseIdParamSchema, courseId), query.expectedVersion);
    return apiSuccess(context, { course });
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { courseId } = await params;
    const input = await parseJsonBody(request, updateCourseSchema);
    const course = await updateCourse(owner.id, parsePathParam(courseIdParamSchema, courseId), input, context.requestId);
    return apiSuccess(context, { course });
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { courseId } = await params;
    const deleted = await deleteCourse(owner.id, parsePathParam(courseIdParamSchema, courseId), context.requestId);
    return apiSuccess(context, { deleted: true, ...deleted });
  });
}
