import { courseListQuerySchema } from "@/contracts/catalog";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listPublishedCourses } from "@/server/modules/catalog/catalog.service";

function searchParamsToObject(url: URL): Record<string, string> {
  // Empty strings are dropped so omitted params fall back to schema defaults
  // (z.coerce would turn `limit=` into 0 instead of the default).
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const query = searchParamsToObject(new URL(request.url));
    const result = courseListQuerySchema.safeParse(query);
    if (!result.success) throw validationError(result.error);
    return apiSuccess(context, await listPublishedCourses(result.data));
  });
}
