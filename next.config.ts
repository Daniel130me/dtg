import type { NextConfig } from "next";

// Render exposes many host CPUs even on resource-constrained instances. Keep
// prerendering parallel enough to be fast without exhausting build resources.
const BUILD_WORKER_COUNT = 4;

const nextConfig: NextConfig = {
  // Render and Cloud Run both start the minimal traced production server.
  // Keeping this unconditional guarantees the start artifact exists after
  // every production build, including manually configured deployments.
  output: "standalone",
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
