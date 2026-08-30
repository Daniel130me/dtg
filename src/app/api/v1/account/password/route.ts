import { changePasswordSchema } from "@/contracts/accounts";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { consumeRateLimit } from "@/server/http/rate-limit";
import { RATE_LIMIT_POLICIES } from "@/server/http/rate-limit-policies";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { changePassword } from "@/server/modules/accounts/accounts.service";

/**
 * POST /api/v1/account/password — rotate the credential password and revoke
 * every other session. The rate limit keys on the (already authenticated)
 * userId: guessing the current password must be expensive per account, not
 * just per IP.
 */
export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    const { user, sessionId } = await requireAuthenticatedUser(request.headers);
    await consumeRateLimit(user.id, RATE_LIMIT_POLICIES.accountSensitive);
    const body = await parseJsonBody(request, changePasswordSchema);

    const result = await changePassword(user.id, sessionId, body, context.requestId);
    return apiSuccess(context, result);
  });
}
