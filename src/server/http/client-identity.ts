import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getServerEnv } from "@/server/config/env";

const MAX_SOURCE_LENGTH = 255;

export type TrustedProxyProvider = "none" | "cloudflare" | "cloud-run";

function validIp(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate : undefined;
}

/**
 * Resolves only provider-owned headers. Cloud Run appends the client and load
 * balancer addresses to X-Forwarded-For, so the penultimate valid address is
 * used instead of a caller-controlled value prepended to the chain.
 */
export function resolveTrustedClientIp(
  request: Request,
  provider: TrustedProxyProvider,
): string | undefined {
  if (provider === "cloudflare") {
    return validIp(request.headers.get("cf-connecting-ip") ?? undefined);
  }

  if (provider === "cloud-run") {
    const chain = (request.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((value) => validIp(value))
      .filter((value): value is string => value !== undefined);
    // Google appends both the client and load-balancer addresses. A shorter
    // chain cannot prove that Google handled the header, so fail closed.
    return chain.length >= 2 ? chain[chain.length - 2] : undefined;
  }

  return undefined;
}

function configuredProxyProvider(): TrustedProxyProvider {
  const env = getServerEnv();
  // Backward compatibility for existing Render environments. New deployments
  // should always select a provider explicitly.
  return env.TRUSTED_PROXY_PROVIDER ?? (env.TRUST_PROXY_HEADERS ? "cloudflare" : "none");
}

export function getTrustedClientIp(request: Request): string | undefined {
  return resolveTrustedClientIp(request, configuredProxyProvider());
}

export function getClientIdentifier(request: Request): string {
  const env = getServerEnv();
  const source = getTrustedClientIp(request) ?? "unidentified";

  return createHmac("sha256", env.RATE_LIMIT_SALT)
    .update(source.slice(0, MAX_SOURCE_LENGTH))
    .digest("hex");
}
