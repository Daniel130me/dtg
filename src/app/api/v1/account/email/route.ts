import { changeEmailSchema } from "@/contracts/accounts";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { consumeRateLimit } from "@/server/http/rate-limit";
import { RATE_LIMIT_POLICIES } from "@/server/http/rate-limit-policies";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { changeEmail } from "@/server/modules/accounts/accounts.service";

/**
 * POST /api/v1/account/email — change the account email behind a
 * current-password check. The current address remains active until the
 * new address is verified; the rate limit keys on the (already
 * authenticated) userId so proof-of-ownership guessing is expensive per
 * account, not just per IP (mirrors /account/password).
 */
export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    await consumeRateLimit(user.id, RATE_LIMIT_POLICIES.accountSensitive);
    const body = await parseJsonBody(request, changeEmailSchema);

    const result = await changeEmail(user.id, body, context.requestId, request.headers);
    return apiSuccess(context, result);
  });
}
