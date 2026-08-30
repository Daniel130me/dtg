import { getClientIdentifier } from "@/server/http/client-identity";
import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import { recordAuthRateLimited } from "@/server/observability/metrics";

const SENSITIVE_AUTH_ACTIONS = new Set([
  "sign-in",
  "sign-up",
  "request-password-reset",
  "reset-password",
  "send-verification-email",
]);
const AUTH_WINDOW_MS = 15 * 60 * 1_000;

export class AuthRateLimitError extends ApiError {
  constructor(public readonly retryAfterSeconds: number) {
    super(429, "RATE_LIMITED", "Too many attempts. Please try again later.");
  }
}

export function progressiveCooldownSeconds(attempts: number): number {
  if (attempts <= 5) return 0;
  if (attempts <= 7) return 30;
  if (attempts <= 9) return 2 * 60;
  return 15 * 60;
}

export function isSensitiveAuthRequest(method: string, pathname: string): boolean {
  const action = pathname.split("/").filter(Boolean).at(-1);
  return method === "POST" && Boolean(action && SENSITIVE_AUTH_ACTIONS.has(action));
}

export async function enforceAuthRateLimit(request: Request): Promise<void> {
  const pathname = new URL(request.url).pathname;
  if (!isSensitiveAuthRequest(request.method, pathname)) return;
  const action = pathname.split("/").filter(Boolean).at(-1)!;

  const now = new Date();
  const windowStartMs = Math.floor(now.getTime() / AUTH_WINDOW_MS) * AUTH_WINDOW_MS;
  const windowStart = new Date(windowStartMs);
  const key = `authentication:${action}:${getClientIdentifier(request)}`;
  const bucket = await db.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: {
      key,
      windowStart,
      expiresAt: new Date(windowStartMs + AUTH_WINDOW_MS),
      count: 1,
    },
    update: { count: { increment: 1 } },
    select: { count: true },
  });

  const retryAfterSeconds = progressiveCooldownSeconds(bucket.count);
  if (retryAfterSeconds === 0) return;

  // Auth-abuse signal: action values are the fixed SENSITIVE_AUTH_ACTIONS set
  // (bounded cardinality); feeds the owner metrics + alert evaluation.
  recordAuthRateLimited(action);

  if ([6, 8, 10].includes(bucket.count)) {
    await db.auditLog.create({
      data: {
        action: "AUTH_RATE_LIMITED",
        entityType: "AuthEndpoint",
        entityId: action,
        metadata: { attempts: bucket.count, retryAfterSeconds },
      },
      select: { id: true },
    });
  }
  throw new AuthRateLimitError(retryAfterSeconds);
}
