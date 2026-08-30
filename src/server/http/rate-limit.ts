import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import { recordRateLimited } from "@/server/observability/metrics";

export interface RateLimitPolicy {
  namespace: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  limit: number;
  remaining: number;
  resetAt: Date;
}

export async function consumeRateLimit(
  identifier: string,
  policy: RateLimitPolicy,
  now = new Date(),
): Promise<RateLimitResult> {
  if (!Number.isInteger(policy.limit) || policy.limit < 1 || policy.windowMs < 1_000) {
    throw new Error("Invalid rate-limit policy.");
  }

  const windowStartMs = Math.floor(now.getTime() / policy.windowMs) * policy.windowMs;
  const windowStart = new Date(windowStartMs);
  const resetAt = new Date(windowStartMs + policy.windowMs);
  const key = `${policy.namespace}:${identifier}`;

  const bucket = await db.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, expiresAt: resetAt, count: 1 },
    update: { count: { increment: 1 }, expiresAt: resetAt },
    select: { count: true },
  });

  if (bucket.count > policy.limit) {
    // Namespace values come from the fixed policy table (bounded cardinality).
    recordRateLimited(policy.namespace);
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  }

  return {
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - bucket.count),
    resetAt,
  };
}
