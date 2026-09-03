import { ownerThreadListQuerySchema } from "@/contracts/learning";
import { requireOwner } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listOwnerThreads } from "@/server/modules/learning/discussions.service";

function searchParamsToObject(url: URL): Record<string, string> {
  // Empty strings are dropped so omitted params fall back to schema defaults.
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

/**
 * GET /api/v1/owner/discussions/threads — every course's Q&A threads,
 * newest activity first, with a status filter (ALL includes hidden).
 */
export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const query = ownerThreadListQuerySchema.safeParse(
      searchParamsToObject(new URL(request.url)),
    );
    if (!query.success) throw validationError(query.error);
    return apiSuccess(context, await listOwnerThreads(query.data));
  });
}
