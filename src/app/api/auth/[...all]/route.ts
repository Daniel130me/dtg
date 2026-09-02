import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";
import { AuthRateLimitError, enforceAuthRateLimit } from "@/server/auth/auth-rate-limit";
import { consumeEmailVerificationToken } from "@/server/auth/email-verification-token";
import { isReservedOwnerEmail } from "@/server/auth/registration-policy";
import { getServerEnv } from "@/server/config/env";
import { db } from "@/server/db/client";

const handlers = toNextJsHandler(auth);
const env = getServerEnv();
const EMAIL_SIGNUP_PATH_SUFFIX = "/sign-up/email";

async function usesReservedOwnerEmail(request: Request): Promise<boolean> {
  if (!new URL(request.url).pathname.endsWith(EMAIL_SIGNUP_PATH_SUFFIX) || !env.OWNER_EMAIL) {
    return false;
  }

  try {
    const body: unknown = await request.clone().json();
    if (!body || typeof body !== "object" || !("email" in body)) return false;
    return typeof body.email === "string" && isReservedOwnerEmail(body.email, env.OWNER_EMAIL);
  } catch {
    // Better Auth owns malformed-body validation and its stable error response.
    return false;
  }
}

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
    if (await usesReservedOwnerEmail(request)) {
      return Response.json(
        {
          code: "OWNER_EMAIL_RESERVED",
          message: "This email cannot be used for student registration.",
        },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
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
