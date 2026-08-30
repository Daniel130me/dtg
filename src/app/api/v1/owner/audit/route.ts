import { ownerAuditQuerySchema } from "@/contracts/owner-ops";
import { requireOwner } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listOwnerAudit } from "@/server/modules/owner/audit.service";

// Owner audit lookup: newest privileged actions first, optional actorId and
// case-insensitive action filters. Read-only — this route never mutates.

function searchParamsToObject(url: URL): Record<string, string> {
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const query = ownerAuditQuerySchema.safeParse(
      searchParamsToObject(new URL(request.url)),
    );
    if (!query.success) throw validationError(query.error);
    return apiSuccess(context, await listOwnerAudit(query.data));
  });
}
