import { z } from "zod";
import { ownerContactStatusSchema } from "@/contracts/owner-ops";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { setOwnerContactStatus } from "@/server/modules/owner/support.service";
import { parseJsonBody } from "@/server/http/validation";

interface RouteParams {
  params: Promise<{ submissionId: string }>;
}

// Owner inbox triage: flip a submission between NEW and ARCHIVED. The write
// and its support.contact.status_changed audit row are one transaction in
// the service; unknown ids 404 with CONTACT_NOT_FOUND.

export async function PATCH(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { submissionId } = await params;
    const body = await parseJsonBody(request, ownerContactStatusSchema);
    return apiSuccess(
      context,
      await setOwnerContactStatus(
        owner.id,
        parsePathParam(z.uuid(), submissionId),
        body,
        context.requestId,
      ),
    );
  });
}
