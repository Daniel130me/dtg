import { exportCreateSchema, exportJobListSchema } from "@/contracts/owner-ops";
import type { ExportJobListDto } from "@/contracts/owner-ops";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { createOwnerExport, listOwnerExports } from "@/server/modules/owner/exports.service";
import { parseJsonBody } from "@/server/http/validation";

// Owner data exports. GET is the job history (no file content; runs the
// piggyback expiry sweep). POST creates a job AND processes it inline in the
// same request — the returned DTO is the finished job (COMPLETED, or FAILED
// with its error recorded on the row), never an accepted-202 marker.

function searchParamsToObject(url: URL): Record<string, string> {
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    // The history response is a fixed-shape list (no query contract); parse
    // it through the wire schema so the shape stays honest at the boundary.
    const list: ExportJobListDto = await listOwnerExports(owner.id);
    return apiSuccess(context, exportJobListSchema.parse(list));
  });
}

export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const body = await parseJsonBody(request, exportCreateSchema);
    return apiSuccess(
      context,
      await createOwnerExport(owner.id, body, context.requestId),
    );
  });
}
