# Render production deployment

This release deploys as two Render services in Frankfurt:

- `dtg-learning-platform`: the Next.js web service, with readiness-gated deploys and Neon migrations in Render's pre-deploy step.
- `dtg-outbox-dispatch`: a one-minute cron job that sends queued email and in-app notifications. Each run is bounded, retries failed work, and recovers abandoned processing leases.

Neon remains the system of record and Cloudflare R2 remains the media store. Render does not receive a local PostgreSQL disk or persistent upload directory.

## 1. Rotate exposed credentials

Before deployment, revoke and recreate every database password, R2 API token, and Gmail app password that has ever been pasted into a chat, screenshot, issue, or log. Do not reuse those values. Store the replacements only in Neon, Cloudflare, Google, and Render's encrypted environment settings.

The R2 token should have Object Read & Write access to the `dtg` bucket only. The application needs the R2 S3 API endpoint for signing requests and a separate public Worker or custom-domain URL for delivery.

## 2. Prepare GitHub

1. Push the repository to GitHub and confirm the `CI` workflow passes on `main`.
2. In GitHub, open **Settings → Branches → Add branch protection rule** for `main`.
3. Require pull requests and the `verify` status check before merge. Prevent force pushes and branch deletion.

Render is configured with `autoDeployTrigger: checksPass`, so a failing or missing GitHub check prevents a production deploy.

## 3. Create the Render Blueprint

1. Sign in to Render and choose **New → Blueprint**.
2. Connect the GitHub repository and select the `main` branch.
3. Render detects `render.yaml`. Review the two services and apply the Blueprint.
4. Enter every value marked `sync: false`. Render prompts for these during the first Blueprint creation; it never stores their plaintext in the repository.

Use these values for the web service:

| Variable | Value |
| --- | --- |
| `APP_URL` | The final HTTPS Render or custom-domain origin, with no path |
| `DATABASE_URL` | Neon pooled connection URL for application traffic |
| `DIRECT_URL` | Neon direct connection URL for migrations |
| `CORS_ORIGINS` | The same exact HTTPS origin as `APP_URL`; comma-separate any additional trusted origins |
| `R2_BUCKET` | `dtg` |
| `R2_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_PUBLIC_BASE_URL` | The HTTPS Worker or custom-domain delivery origin |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | The new bucket-scoped R2 token credentials |
| `EMAIL_FROM` | A valid sender such as `DTG <owner@example.com>` |
| `SMTP_HOST`, `SMTP_PORT` | Gmail uses `smtp.gmail.com` and port `587` |
| `SMTP_USER`, `SMTP_PASSWORD` | SMTP account and newly generated app password |
| `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH` | Set both for paid checkout, or leave both unset |
| `OWNER_EMAIL` | The single instructor's normalized email address |

The Blueprint sets `TRUSTED_PROXY_PROVIDER=cloudflare`. Do not copy the Cloud
Run proxy setting into Render or accept caller-provided forwarding headers.

For the cron service, enter the same `APP_URL`, Neon pooled `DATABASE_URL`, and SMTP values. The cron worker does not need R2 or the Neon direct URL.

If the generated Render hostname differs from the origin initially entered, update `APP_URL` and `CORS_ORIGINS` immediately after creation and redeploy. Also configure the exact application origin in the R2 bucket CORS policy. Render supplies `PORT`; do not add or override it.

## 4. Verify the first release

The web deployment order is deliberate:

1. install locked dependencies and build;
2. apply committed Prisma migrations through the Neon direct URL;
3. start Next.js on Render's assigned port;
4. pass `/api/v1/health/ready` before receiving traffic.

The Blueprint bounds the database readiness probe to four seconds so it
finishes within Render's five-second health-check response window.

After the service reports **Live**, run the read-only smoke suite locally:

```bash
npm run smoke -- https://your-service.onrender.com
```

Confirm all checks pass, then test these user journeys with non-production test accounts:

1. sign-up verification and forgot-password email;
2. owner login, profile settings, course creation, and direct video upload;
3. student enrolment, lesson playback, progress, Q&A, and owner reply;
4. payment webhook fulfilment if Flutterwave is enabled;
5. notification delivery and a successful `dtg-outbox-dispatch` cron run.

## 5. Provision the single owner if required

Only do this for a new database with no configured owner. Open the web service's Render Shell, temporarily set `ALLOW_OWNER_BOOTSTRAP=true` plus `OWNER_DISPLAY_NAME` and a password-manager-generated `OWNER_PASSWORD`, then run:

```bash
npm run owner:bootstrap
```

Immediately remove `OWNER_PASSWORD` and `OWNER_DISPLAY_NAME`, restore `ALLOW_OWNER_BOOTSTRAP=false`, and redeploy. The command refuses to create a second owner once platform ownership exists.

## 6. Normal CI/CD operation

For every change:

1. open a pull request;
2. wait for lint, type checking, tests, a clean migration against PostgreSQL 17, and the production build;
3. merge only after review and a green `verify` check;
4. Render automatically builds the approved commit, applies migrations, and replaces the web instance only after readiness passes.

Use backward-compatible, expand-and-contract migrations. Application rollback does not reverse a database migration. If a release is unhealthy, use Render's rollback to restore the prior application build, then ship a forward database correction rather than running destructive rollback SQL.

## 7. Production operations

- Use the configured paid web plan for production; free instances can sleep and are not suitable for this launch.
- Watch both service logs during and after every release. A non-zero cron exit signals a dispatch failure that needs investigation.
- Monitor `/api/v1/health/ready`; keep `/api/v1/health/diagnostics` and `/api/v1/metrics` owner-authenticated.
- Logs automatically use Render's `RENDER_GIT_COMMIT` as the release ID; an explicit `RELEASE_ID` can override it.
- Add the custom domain in Render before changing `APP_URL`, `CORS_ORIGINS`, R2 CORS, payment callbacks, or email links to that domain.
- Back up Neon independently and rehearse the recovery runbook before launch.

## Troubleshooting

- **Build succeeds but the service never becomes healthy:** inspect the Render logs for invalid environment configuration, then verify both Neon URLs and `/api/v1/health/ready`.
- **Authentication redirects to localhost or the wrong host:** correct `APP_URL`, `CORS_ORIGINS`, and the custom-domain DNS, then redeploy.
- **Uploads fail:** confirm `R2_S3_ENDPOINT` is the S3 API hostname, not the Worker delivery URL, and confirm the token is scoped to the `dtg` bucket.
- **Emails do not arrive:** inspect the cron logs, verify all four SMTP fields plus `EMAIL_FROM`, and confirm the Gmail app password is current.
- **A Blueprint gains a new `sync: false` variable later:** add it manually to each existing service; subsequent Blueprint syncs do not prompt for newly added secret values.
