import { courseSlugParamSchema } from "@/contracts/catalog";
import { reviewListQuerySchema } from "@/contracts/reviews";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listCourseReviews } from "@/server/modules/reviews/reviews.service";

function searchParamsToObject(url: URL): Record<string, string> {
  // Empty strings are dropped so omitted params fall back to schema defaults
  // (mirrors the discussions list routes).
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

// PUBLIC endpoint: no auth — the reviews page renders for signed-out visitors.
// The service gates the list to published courses and VISIBLE rows.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return executeRoute(request, async (context) => {
    const { slug } = await params;
    const slugParam = courseSlugParamSchema.safeParse({ slug });
    if (!slugParam.success) throw validationError(slugParam.error);
    const query = reviewListQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
    if (!query.success) throw validationError(query.error);
    return apiSuccess(context, await listCourseReviews(slugParam.data.slug, query.data));
  });
}
