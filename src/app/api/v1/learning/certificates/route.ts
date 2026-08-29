import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { getMyCertificates } from "@/server/modules/certificates/certificates.service";

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    return apiSuccess(context, await getMyCertificates(user.id));
  });
}
