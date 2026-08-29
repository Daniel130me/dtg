import { certificateIdParamSchema, certificateRevokeSchema } from "@/contracts/certificates";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { revokeCertificate } from "@/server/modules/certificates/certificates.service";

interface RouteParams {
  params: Promise<{ certificateId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const owner = await requireOwner(request.headers);
    const { certificateId } = await params;
    const input = await parseJsonBody(request, certificateRevokeSchema);
    return apiSuccess(
      context,
      await revokeCertificate(
        owner.id,
        parsePathParam(certificateIdParamSchema, certificateId),
        input.reason,
        context.requestId,
      ),
    );
  });
}
