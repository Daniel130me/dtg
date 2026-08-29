import { courseSlugParamSchema } from "@/contracts/catalog";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { getPublishedCourseBySlug } from "@/server/modules/catalog/catalog.service";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return executeRoute(request, async (context) => {
    const { slug } = await params;
    const result = courseSlugParamSchema.safeParse({ slug });
    if (!result.success) throw validationError(result.error);
    return apiSuccess(context, await getPublishedCourseBySlug(result.data));
  });
}
