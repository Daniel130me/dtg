# Google mirrors popular Docker Hub images, avoiding anonymous pull limits in
# Cloud Build while preserving the official Node image contents.
FROM mirror.gcr.io/library/node:24.14.1-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# These non-production placeholders only satisfy build-time validation. Keeping
# them scoped to this command avoids baking runtime configuration into the image.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    APP_URL=http://localhost:8080 \
    RATE_LIMIT_SALT=container-build-only-rate-limit-salt \
    BETTER_AUTH_SECRET=container-build-only-auth-secret-value \
    npm run build

FROM base AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]

# Jobs keep the Prisma CLI and TypeScript runner. They are isolated from the
# latency-sensitive web image and always exit when their one task completes.
FROM base AS jobs
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs package.json package-lock.json prisma.config.ts tsconfig.json ./
COPY --chown=nextjs:nodejs prisma ./prisma
COPY --chown=nextjs:nodejs scripts ./scripts
COPY --chown=nextjs:nodejs src ./src
USER nextjs
CMD ["npm", "run", "jobs:outbox"]
