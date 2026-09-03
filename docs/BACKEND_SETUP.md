# Backend setup

For the production release process, environment matrix, and CI/CD flow, see
[Render production deployment](./RENDER_DEPLOYMENT.md).

For the alternative Google Cloud deployment, see
[Cloud Run production deployment](./GCP_CLOUD_RUN_DEPLOYMENT.md).

## Supported runtime

- Node.js 24 LTS-compatible runtime
- npm 11
- PostgreSQL 17-compatible database (Neon PostgreSQL in production)
- Prisma 6 for the current release line

Use `npm ci` for repeatable installs. Bun is not required by application scripts.

## Environment setup

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to the Neon pooled connection for runtime queries.
3. Set `DIRECT_URL` to the Neon direct connection for migrations. The direct host normally omits the `-pooler` segment.
4. Use a separate database or Neon branch for `TEST_DATABASE_URL`. Never point integration tests at production.
5. Generate independent random values for `RATE_LIMIT_SALT` and `BETTER_AUTH_SECRET`; do not reuse passwords or provider secrets.
6. Configure `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASSWORD` together so verification and recovery emails can be delivered.
7. Set `TRUSTED_PROXY_PROVIDER` to `render` on Render, `cloud-run` on Google
   Cloud Run, `cloudflare` only behind a direct Cloudflare edge, and `none`
   locally. `TRUST_PROXY_HEADERS` is a legacy compatibility setting.
8. Keep `DB_READINESS_TIMEOUT_MS` at `10000` for Neon unless production latency measurements justify a different bounded value.
9. Leave R2 variables empty until media uploads are enabled.

Secrets must be stored in the deployment platform's encrypted environment settings. Never commit `.env` files or paste production credentials into issues, pull requests, test fixtures, or logs.

## Commands

```bash
npm run db:generate
npm run db:migrate
npm run db:migrate:deploy
npm run db:migrate:test
npm run db:migrate:status
npm run db:seed
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify
```

`db:migrate` is for local development. CI and production use `db:migrate:deploy`. `prisma db push --accept-data-loss` is intentionally not exposed as a project script.

## Initial owner

Owner provisioning is an explicit one-time operation and is disabled unless opted in:

```bash
ALLOW_OWNER_BOOTSTRAP=true OWNER_EMAIL=owner@example.com OWNER_DISPLAY_NAME="Platform Owner" OWNER_PASSWORD="use-a-password-manager-generated-value" npm run owner:bootstrap
```

Do not place those values in tracked files. Once `PlatformSettings` exists, the bootstrap command refuses to create another owner. Future owner changes must use the authenticated, audited ownership-transfer service.
