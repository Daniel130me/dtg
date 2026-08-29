import { courseSlugParamSchema } from "@/contracts/catalog";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { getCourseEnrolmentState } from "@/server/modules/enrolments/enrolments.service";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { slug } = await params;
    const parsed = courseSlugParamSchema.safeParse({ slug });
    if (!parsed.success) throw validationError(parsed.error);
    const state = await getCourseEnrolmentState(user.id, parsed.data.slug);
    return apiSuccess(context, state);
  });
}
