import { lessonVideoPartUrlsSchema } from "@/contracts/lesson-video";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { lessonIdParamSchema, parsePathParam } from "@/server/modules/courses/courses.schemas";
import { createLessonVideoPartUrls } from "@/server/modules/courses/lesson-video.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { lessonId } = await params;
    const parts = await createLessonVideoPartUrls(
      parsePathParam(lessonIdParamSchema, lessonId),
      await parseJsonBody(request, lessonVideoPartUrlsSchema),
    );
    return apiSuccess(context, { parts });
  });
}
