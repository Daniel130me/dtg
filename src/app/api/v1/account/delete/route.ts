import { auth } from "@/server/auth/auth";
import { DELETION_CONFIRMATION_MISMATCH, deleteAccountSchema } from "@/contracts/accounts";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { ApiError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { consumeRateLimit } from "@/server/http/rate-limit";
import { RATE_LIMIT_POLICIES } from "@/server/http/rate-limit-policies";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { deleteAccount } from "@/server/modules/accounts/accounts.service";
import { evaluateDeletionConfirmation } from "@/server/modules/accounts/accounts.logic";

/**
 * POST /api/v1/account/delete — self-service deletion behind the typed
 * "DELETE" confirmation. The transaction anonymizes the account and deletes
 * every session; after it commits, better-auth's signOut runs against the
 * (already revoked) session purely so the response clears the session cookie
 * with better-auth's own cookie attributes.
 */
export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    await consumeRateLimit(user.id, RATE_LIMIT_POLICIES.accountSensitive);
    const body = await parseJsonBody(request, deleteAccountSchema);

    // Defense in depth: the contract only types the field; the exact word is
    // a business rule enforced here before anything is written.
    const confirmation = evaluateDeletionConfirmation(body.confirmation);
    if (!confirmation.ok) {
      throw new ApiError(
        422,
        DELETION_CONFIRMATION_MISMATCH,
        'Type "DELETE" exactly to confirm account deletion.',
      );
    }

    const result = await deleteAccount(user.id, context.requestId);

    // The session row is gone; signOut still clears the cookie (it tolerates
    // a missing session), and its Set-Cookie headers are forwarded to the
    // caller so the browser drops the session token immediately.
    const response = apiSuccess(context, result);
    try {
      // returnHeaders makes better-auth hand back the Set-Cookie headers it
      // would send, so the browser drops the session token immediately.
      const signOut = await auth.api.signOut({
        headers: request.headers,
        returnHeaders: true,
      });
      for (const cookie of signOut.headers.getSetCookie()) {
        response.headers.append("set-cookie", cookie);
      }
    } catch {
      // Cookie clearing is best-effort: the session is already deleted
      // server-side, so the next request 401s even if this failed.
    }

    return response;
  });
}
