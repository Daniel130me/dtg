import { updateAccountProfileSchema } from "@/contracts/accounts";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import {
  getAccountProfile,
  updateAccountProfile,
} from "@/server/modules/accounts/accounts.service";

/** GET /api/v1/account/profile — the signed-in account holder's profile + stats. */
export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    return apiSuccess(context, await getAccountProfile(user.id));
  });
}

/** PATCH /api/v1/account/profile — allowlisted profile/preferences update. */
export async function PATCH(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const body = await parseJsonBody(request, updateAccountProfileSchema);
    return apiSuccess(context, await updateAccountProfile(user.id, body, context.requestId));
  });
}
