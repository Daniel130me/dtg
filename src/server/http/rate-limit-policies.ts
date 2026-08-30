import type { RateLimitPolicy } from "@/server/http/rate-limit";

const ONE_MINUTE_MS = 60_000;
const FIFTEEN_MINUTES_MS = 15 * ONE_MINUTE_MS;

/** Central policies keep endpoint limits reviewable and free of inline magic values. */
export const RATE_LIMIT_POLICIES = {
  publicRead: {
    namespace: "public-read",
    limit: 120,
    windowMs: ONE_MINUTE_MS,
  },
  authentication: {
    namespace: "authentication",
    limit: 10,
    windowMs: FIFTEEN_MINUTES_MS,
  },
  mutation: {
    namespace: "mutation",
    limit: 60,
    windowMs: ONE_MINUTE_MS,
  },
  upload: {
    namespace: "upload",
    limit: 20,
    windowMs: ONE_MINUTE_MS,
  },
  // Anonymous writes are the highest-abuse surface: a strict per-identity
  // window backs the public contact form (honeypot + heuristics behind it).
  contact: {
    namespace: "contact",
    limit: 5,
    windowMs: FIFTEEN_MINUTES_MS,
  },
} as const satisfies Record<string, RateLimitPolicy>;
