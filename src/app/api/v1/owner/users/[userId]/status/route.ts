import { ownerUserStatusSchema } from "@/contracts/owner-ops";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { setOwnerUserStatus } from "@/server/modules/owner/students.service";
import { parseJsonBody } from "@/server/http/validation";
import { z } from "zod";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

// Owner user-status operation (ACTIVE ⇄ SUSPENDED). The contract body schema
// is authoritative; self/OWNER/DELETED targets are refused by the service
// guard with OWNER_USER_STATUS_FORBIDDEN / OWNER_USER_NOT_FOUND.

export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { userId } = await params;
    const body = await parseJsonBody(request, ownerUserStatusSchema);
    return apiSuccess(
      context,
      await setOwnerUserStatus(
        owner.id,
        parsePathParam(z.uuid(), userId),
        body,
        context.requestId,
      ),
    );
  });
}
