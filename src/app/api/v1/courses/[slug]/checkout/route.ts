import { courseSlugParamSchema } from "@/contracts/catalog";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { initializeCheckout } from "@/server/modules/payments/checkout.service";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { slug } = await params;
    const parsed = courseSlugParamSchema.safeParse({ slug });
    if (!parsed.success) throw validationError(parsed.error);
    // Fails closed with 503 PAYMENT_PROVIDER_NOT_CONFIGURED until a launch
    // payment provider is configured (Phase 7 payments milestone).
    const session = await initializeCheckout(user.id, parsed.data.slug);
    return apiSuccess(context, { session });
  });
}
