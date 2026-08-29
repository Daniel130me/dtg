import { gradingQueueQuerySchema } from "@/contracts/assessments";
import { requireOwner } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listGradingQueue } from "@/server/modules/assessments/submissions.service";

// Owner grading queue: newest submissions first, cursor-paginated, optional
// courseId/status filters. Empty query params are dropped so a blank `status=`
// does not fail the enum parse (same treatment as the threads list).

function searchParamsToObject(url: URL): Record<string, string> {
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const query = gradingQueueQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
    if (!query.success) throw validationError(query.error);
    return apiSuccess(context, await listGradingQueue(query.data));
  });
}
