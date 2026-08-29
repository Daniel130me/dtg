import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody, parseSearchParams } from "@/server/http/validation";
import { createCourse, listOwnerCourses } from "@/server/modules/courses/courses.service";
import {
  createCourseSchema,
  listOwnerCoursesQuerySchema,
} from "@/server/modules/courses/courses.schemas";

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const filters = parseSearchParams(new URL(request.url), listOwnerCoursesQuerySchema);
    const courses = await listOwnerCourses(filters);
    return apiSuccess(context, { courses });
  });
}

export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const input = await parseJsonBody(request, createCourseSchema);
    const course = await createCourse(owner.id, input, context.requestId);
    return apiSuccess(context, { course }, 201);
  });
}
