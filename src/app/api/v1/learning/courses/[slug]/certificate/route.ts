import { courseSlugParamSchema } from "@/contracts/catalog";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { issueCertificate } from "@/server/modules/certificates/certificates.service";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { slug } = await params;
    const result = courseSlugParamSchema.safeParse({ slug });
    if (!result.success) throw validationError(result.error);
    return apiSuccess(context, await issueCertificate(user.id, result.data.slug, context.requestId));
  });
}
