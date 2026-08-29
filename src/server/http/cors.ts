import { ApiError } from "@/server/http/errors";
import { getServerEnv } from "@/server/config/env";

export function assertAllowedOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (!getServerEnv().corsOrigins.has(origin)) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This request origin is not allowed.");
  }
}

export function preflightHeaders(request: Request): HeadersInit {
  assertAllowedOrigin(request);
  const origin = request.headers.get("origin");
  return origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, idempotency-key, x-request-id",
        "access-control-max-age": "600",
        vary: "Origin",
      }
    : {};
}
