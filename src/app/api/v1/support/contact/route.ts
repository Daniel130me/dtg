import { contactSubmissionSchema } from "@/contracts/support";
import { getClientIdentifier } from "@/server/http/client-identity";
import { apiSuccess } from "@/server/http/responses";
import { RATE_LIMIT_POLICIES } from "@/server/http/rate-limit-policies";
import { consumeRateLimit } from "@/server/http/rate-limit";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { submitContact, type ContactRequestMeta } from "@/server/modules/support/contact.service";
import { getServerEnv } from "@/server/config/env";

// Public contact form: the highest-abuse anonymous surface. Layered controls:
// 1. rate limit per hashed client identity (transport level, before parsing);
// 2. honeypot + link heuristic in the service (generic rejection message);
// 3. stored ip/user-agent only when TRUST_PROXY_HEADERS says they are real —
//    otherwise the socket peer is not exposed to route handlers and storing
//    client-supplied headers would let bots poison the abuse record.
const MAX_USER_AGENT_LENGTH = 512;

function resolveRequestMeta(request: Request): ContactRequestMeta {
  const env = getServerEnv();
  const userAgent = request.headers.get("user-agent")?.trim().slice(0, MAX_USER_AGENT_LENGTH) || undefined;
  if (!env.TRUST_PROXY_HEADERS) return { userAgent };

  const ipAddress =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    undefined;
  return { ipAddress, userAgent };
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
