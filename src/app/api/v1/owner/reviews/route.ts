import { ownerReviewListQuerySchema } from "@/contracts/reviews";
import { requireOwner } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listOwnerReviews } from "@/server/modules/reviews/reviews.service";

function searchParamsToObject(url: URL): Record<string, string> {
  // Empty strings are dropped so omitted params fall back to schema defaults.
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const query = ownerReviewListQuerySchema.safeParse(
      searchParamsToObject(new URL(request.url)),
    );
    if (!query.success) throw validationError(query.error);
    return apiSuccess(context, await listOwnerReviews(owner.id, query.data));
  });
}
