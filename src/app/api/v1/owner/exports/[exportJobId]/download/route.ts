import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/server/auth/authorization";
import { executeRoute } from "@/server/http/route-handler";
import { exportDownloadFilename } from "@/server/modules/owner/exports.logic";
import { downloadOwnerExport } from "@/server/modules/owner/exports.service";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";

interface RouteParams {
  params: Promise<{ exportJobId: string }>;
}

// Owner export download. Raw file response (not the JSON envelope) — mirrors
// the certificate download route: the link IS the file, executeRoute still
// wraps the handler for request-id/cors/error handling and the response
// carries the requestId header so a failed download is traceable. Expiry and
// readiness are enforced in the service (410/409 as ApiErrors); this route
// only renders the bytes of a live COMPLETED job.

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { exportJobId } = await params;
    const { job, content } = await downloadOwnerExport(
      owner.id,
      parsePathParam(z.uuid(), exportJobId),
      context.requestId,
    );

    return new NextResponse(content, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        // A live COMPLETED job always carries completedAt; createdAt is the
        // defensive fallback so the header can never render "undefined".
        "content-disposition": `attachment; filename="${exportDownloadFilename(
          job.type,
          job.completedAt ?? job.createdAt,
        )}"`,
        "cache-control": "no-store",
        "x-request-id": context.requestId,
      },
    });
  });
}
