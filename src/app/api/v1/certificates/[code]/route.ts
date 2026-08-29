import { certificateCodeParamSchema } from "@/contracts/certificates";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { verifyPublicCertificate } from "@/server/modules/certificates/certificates.service";

interface RouteParams {
  params: Promise<{ code: string }>;
}

/**
 * Public certificate verification: intentionally NO auth — anyone holding a
 * verification code (e.g. an employer) can check authenticity. The payload
 * reveals only the learner's display name and the course title, never an
 * email, and unknown codes get the same 404 regardless of shape.
 */
export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { code } = await params;
    const result = certificateCodeParamSchema.safeParse(code);
    if (!result.success) throw validationError(result.error);
    return apiSuccess(context, await verifyPublicCertificate(result.data));
  });
}
