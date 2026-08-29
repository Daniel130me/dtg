import { courseSlugParamSchema } from "@/contracts/catalog";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { enrollInFreeCourse } from "@/server/modules/enrolments/enrolments.service";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { slug } = await params;
    const parsed = courseSlugParamSchema.safeParse({ slug });
    if (!parsed.success) throw validationError(parsed.error);
    const enrolment = await enrollInFreeCourse(user.id, parsed.data.slug, context.requestId);
    return apiSuccess(context, { enrolment });
  });
}
