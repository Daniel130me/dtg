import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";
import { AuthRateLimitError, enforceAuthRateLimit } from "@/server/auth/auth-rate-limit";
import { consumeEmailVerificationToken } from "@/server/auth/email-verification-token";
import { db } from "@/server/db/client";

const handlers = toNextJsHandler(auth);

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/verify-email")) {
    const token = url.searchParams.get("token");
    if (!token || !(await consumeEmailVerificationToken(db, token))) {
      return Response.json(
        { code: "INVALID_TOKEN", message: "The verification link is invalid or has expired." },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
  }
  return handlers.GET(request);
}

export async function POST(request: Request): Promise<Response> {
  try {
    await enforceAuthRateLimit(request);
    return handlers.POST(request);
  } catch (error) {
    if (error instanceof AuthRateLimitError) {
      return Response.json(
        { code: "TOO_MANY_REQUESTS", message: error.message },
        {
          status: 429,
          headers: {
            "cache-control": "no-store",
            "retry-after": String(error.retryAfterSeconds),
          },
        },
      );
    }
    throw error;
  }
}
