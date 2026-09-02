import { ownerCertificatesQuerySchema } from "@/contracts/certificates";
import { requireOwner } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listCertificatesForOwner } from "@/server/modules/certificates/certificates.service";

// Owner console certificate list: every issued certificate with learner and
// course context, filterable by course/status and searchable by learner or
// code. The revoke mutation lives on /owner/certificates/{certificateId}/revoke.

function searchParamsToObject(url: URL): Record<string, string> {
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const query = ownerCertificatesQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
    if (!query.success) throw validationError(query.error);
    return apiSuccess(context, await listCertificatesForOwner(query.data));
  });
}
