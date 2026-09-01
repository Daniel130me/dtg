import { thumbnailUploadRequestSchema } from "@/contracts/course-media";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { createThumbnailUploadTicket } from "@/server/modules/courses/course-media.service";
import { courseIdParamSchema, parsePathParam } from "@/server/modules/courses/courses.schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { courseId } = await params;
    const input = await parseJsonBody(request, thumbnailUploadRequestSchema);
    const upload = await createThumbnailUploadTicket(
      parsePathParam(courseIdParamSchema, courseId),
      input,
    );
    return apiSuccess(context, { upload });
  });
}
