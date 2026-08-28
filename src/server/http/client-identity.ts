import { createHmac } from "node:crypto";
import { getServerEnv } from "@/server/config/env";

const MAX_SOURCE_LENGTH = 255;

export function getClientIdentifier(request: Request): string {
  const env = getServerEnv();
  let source = "unidentified";

  if (env.TRUST_PROXY_HEADERS) {
    source =
      request.headers.get("cf-connecting-ip")?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
      source;
  }

  return createHmac("sha256", env.RATE_LIMIT_SALT)
    .update(source.slice(0, MAX_SOURCE_LENGTH))
    .digest("hex");
}
