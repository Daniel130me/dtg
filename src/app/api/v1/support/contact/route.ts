import { contactSubmissionSchema } from "@/contracts/support";
import { getClientIdentifier, getTrustedClientIp } from "@/server/http/client-identity";
import { apiSuccess } from "@/server/http/responses";
import { RATE_LIMIT_POLICIES } from "@/server/http/rate-limit-policies";
import { consumeRateLimit } from "@/server/http/rate-limit";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { submitContact, type ContactRequestMeta } from "@/server/modules/support/contact.service";

// Public contact form: the highest-abuse anonymous surface. Layered controls:
// 1. rate limit per hashed client identity (transport level, before parsing);
// 2. honeypot + link heuristic in the service (generic rejection message);
// 3. stored ip/user-agent only when the configured provider says they are real —
//    otherwise the socket peer is not exposed to route handlers and storing
//    client-supplied headers would let bots poison the abuse record.
const MAX_USER_AGENT_LENGTH = 512;

function resolveRequestMeta(request: Request): ContactRequestMeta {
  const userAgent = request.headers.get("user-agent")?.trim().slice(0, MAX_USER_AGENT_LENGTH) || undefined;
  return { ipAddress: getTrustedClientIp(request), userAgent };
}

export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    await consumeRateLimit(getClientIdentifier(request), RATE_LIMIT_POLICIES.contact);
    const input = await parseJsonBody(request, contactSubmissionSchema);
    return apiSuccess(
      context,
      await submitContact(input, resolveRequestMeta(request), context.requestId),
      201,
    );
  });
}
