import { ownerContactListQuerySchema } from "@/contracts/owner-ops";
import { requireOwner } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listOwnerContactSubmissions } from "@/server/modules/owner/support.service";

// Owner support inbox: every public contact submission, newest first,
// optional NEW/ARCHIVED filter. Purged rows read through with null fields
// (the retention sweep nulls storage, the DTO passes the nulls on).

function searchParamsToObject(url: URL): Record<string, string> {
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const query = ownerContactListQuerySchema.safeParse(
      searchParamsToObject(new URL(request.url)),
    );
    if (!query.success) throw validationError(query.error);
    return apiSuccess(context, await listOwnerContactSubmissions(query.data));
  });
}
