import { completeThumbnailUploadSchema } from "@/contracts/course-media";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { completeThumbnailUpload } from "@/server/modules/courses/course-media.service";
import { courseIdParamSchema, parsePathParam } from "@/server/modules/courses/courses.schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { courseId } = await params;
    const thumbnail = await completeThumbnailUpload(
      owner.id,
      parsePathParam(courseIdParamSchema, courseId),
      await parseJsonBody(request, completeThumbnailUploadSchema),
      context.requestId,
    );
    return apiSuccess(context, { thumbnail });
  });
}
