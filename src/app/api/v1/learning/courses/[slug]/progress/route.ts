import { courseSlugParamSchema } from "@/contracts/catalog";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { getCourseProgress } from "@/server/modules/learning/progress.service";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { slug } = await params;
    const result = courseSlugParamSchema.safeParse({ slug });
    if (!result.success) throw validationError(result.error);
    return apiSuccess(context, await getCourseProgress(user.id, result.data.slug));
  });
}
