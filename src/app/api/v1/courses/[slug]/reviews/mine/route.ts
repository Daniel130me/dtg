import { courseSlugParamSchema } from "@/contracts/catalog";
import { reviewUpsertSchema } from "@/contracts/reviews";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import {
  deleteMyReview,
  getMyReview,
  upsertMyReview,
} from "@/server/modules/reviews/reviews.service";
import { parseJsonBody } from "@/server/http/validation";

async function resolveSlug(params: Promise<{ slug: string }>): Promise<string> {
  const { slug } = await params;
  const slugParam = courseSlugParamSchema.safeParse({ slug });
  if (!slugParam.success) throw validationError(slugParam.error);
  return slugParam.data.slug;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const slug = await resolveSlug(params);
    // The wire payload is the bare review or null (the pre-registered client
    // wrapper unwraps nothing); the {review} shape stays service-internal.
    const { review } = await getMyReview(user.id, slug);
    return apiSuccess(context, review);
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const slug = await resolveSlug(params);
    const input = await parseJsonBody(request, reviewUpsertSchema);
    return apiSuccess(
      context,
      await upsertMyReview(user.id, slug, input, context.requestId),
    );
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const slug = await resolveSlug(params);
    return apiSuccess(context, await deleteMyReview(user.id, slug, context.requestId));
  });
}
