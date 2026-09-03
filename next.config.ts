import type { NextConfig } from "next";

// Render exposes many host CPUs even on resource-constrained instances. Keep
// prerendering parallel enough to be fast without exhausting build resources.
const BUILD_WORKER_COUNT = 4;

const nextConfig: NextConfig = {
  // Cloud Run uses Next's minimal traced server image. Other deployment
  // targets keep the standard `next start` output and remain unaffected.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    cpus: BUILD_WORKER_COUNT,
  },
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=()",
      },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];

    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
