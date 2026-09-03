# Render Free live-test deployment

This is the simplest way to put DTG online temporarily: one Render **Free Web
Service**, Neon for PostgreSQL, and Cloudflare R2 for media. The checked-in
Cloud Run files remain available for the later production deployment.

## 1. Free-plan limitations

Use this deployment for testing, not a production launch:

- the service sleeps after 15 minutes without inbound traffic, so its first
  request after sleeping is slow;
- the filesystem is ephemeral, so all durable data must stay in Neon or R2;
- Render Free blocks outbound SMTP ports 25, 465, and 587, so Gmail signup
  verification, password-reset email, and notification email cannot be tested;
- Free services have no pre-deploy command or Shell; migrations therefore run
  as the final build step;
- no Render cron job is included. Outbox email dispatch remains disabled for
  this test and can be added with the later production infrastructure.

Do not add Gmail credentials to this Free service. Use an existing verified
student account and the existing owner account for the live test. Do not weaken
email verification or expose reset links merely to work around a hosting-plan
restriction.

## 2. Protect credentials

Revoke and recreate any Neon password or R2 token that has appeared in chat,
screenshots, issues, or logs. Never commit secrets. The R2 token should have
Object Read & Write access to the `dtg` bucket only.

- `DATABASE_URL`: Neon pooled URL for application traffic.
- `DIRECT_URL`: Neon direct URL for Prisma migrations.
- `R2_S3_ENDPOINT`: `https://<account-id>.r2.cloudflarestorage.com`.
- `R2_PUBLIC_BASE_URL`: the separate Worker or public delivery origin.

## 3. Push the prepared commit

Push the prepared revision to GitHub and confirm the repository's `CI` workflow
passes on `main`. The Blueprint uses `autoDeployTrigger: checksPass`, so later
deploys wait for GitHub checks to pass.

## 4. Create one Free web service

1. Sign in to Render and choose **New → Blueprint**.
2. Connect the GitHub repository containing this project.
3. Select the `main` branch. Render detects the root `render.yaml`.
4. Confirm there is exactly one service named `dtg-learning-platform`, with
   type **Web Service**, region Frankfurt, and plan **Free**.
5. Enter every value Render requests using the table below.
6. Apply the Blueprint and watch the Events/build logs until it reports Live.

Do not create a Static Site, Background Worker, Cron Job, PostgreSQL service,
or persistent disk for this live test.

## 5. Environment values

Enter values without surrounding quotation marks.

| Variable | Value |
| --- | --- |
| `APP_URL` | Initially `https://dtg-learning-platform.onrender.com`; correct it if Render assigns a different hostname |
| `DATABASE_URL` | Neon pooled production URL |
| `DIRECT_URL` | Neon direct production URL |
| `CORS_ORIGINS` | Exactly the same origin as `APP_URL`, without a trailing slash |
| `OWNER_EMAIL` | The single instructor's normalized email address |
| `R2_BUCKET` | `dtg` |
| `R2_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_PUBLIC_BASE_URL` | HTTPS Worker or custom delivery origin |
| `R2_ACCESS_KEY_ID` | New bucket-scoped R2 access-key ID |
| `R2_SECRET_ACCESS_KEY` | New bucket-scoped R2 secret key |

The Blueprint supplies the verified `NODE_VERSION=24.14.1`, `NODE_ENV`, secure
generated application secrets, `HOSTNAME=0.0.0.0`, and
`TRUSTED_PROXY_PROVIDER=render`. Render supplies `PORT`; do not set it.

If the assigned hostname differs from `APP_URL`, open **Service → Environment**,
update both `APP_URL` and `CORS_ORIGINS`, save them, and choose **Manual Deploy
→ Deploy latest commit**. Add that exact origin to the R2 bucket CORS policy.

Leave SMTP and Flutterwave variables unset for this test. Partial SMTP or
Flutterwave configuration intentionally prevents the app from booting.

## 6. Deployment sequence

The Blueprint runs this sequence:

1. install locked dependencies;
2. build the standalone Next.js server and copy its public/static assets;
3. run committed Prisma migrations against `DIRECT_URL`;
4. start on Render's assigned `PORT` and `0.0.0.0`;
5. check `/api/v1/health/ready` before marking the service healthy.

The migration runs only after a successful compile. A migration failure stops
the deployment. Unlike a paid pre-deploy command, a successful migration can
remain applied if a later service start fails. Migrations must therefore remain
backward-compatible, as required by `docs/MIGRATION_RUNBOOK.md`.

Free has no Shell. If a fresh database needs its first owner, run
`npm run owner:bootstrap` locally against that Neon database using the guarded
bootstrap variables documented in `docs/BACKEND_SETUP.md`, then remove those
temporary variables. The command refuses to create a second owner.

## 7. Verify the deployment

After Render reports **Live**, run:

```bash
npm run smoke -- https://your-actual-service.onrender.com
```

All nine checks must pass. Then use the existing verified test accounts to:

1. sign in as owner and open owner settings;
2. create a draft course, add curriculum, and upload a lecture video;
3. enrol the verified student and play the uploaded lesson;
4. post a student Q&A item and answer it as owner.

Signup verification, forgot-password email, notification email, and paid
checkout are outside this Free live test. Test them locally with SMTP or later
on infrastructure that supports the required delivery provider.

## 8. Releases and rollback

For each change, open a pull request, wait for CI, review, and merge. Render
automatically deploys the passing `main` revision. If a release is unhealthy,
use **Service → Deploys → Rollback** for application code and fix database
migrations forward. Never run `prisma migrate reset` against Neon production.

## Troubleshooting

- **`.next/standalone` is missing:** confirm Render built the latest commit,
  then choose **Manual Deploy → Clear build cache & deploy**. Standalone output
  is generated unconditionally by the checked-in Next.js configuration.
- **Prerender fails with internal `<meta>`, `<head>`, or viewport key
  warnings:** confirm `NODE_ENV` is exactly `production` (lowercase, without
  quotes or surrounding spaces) and Render is building the latest commit with
  Node 24.14.1. Remove any duplicate `NODE_ENV` entry, then choose **Manual
  Deploy → Clear build cache & deploy**. The checked-in Next.js configuration
  limits prerendering to four workers; the build log should no longer report
  dozens of workers. These warnings originate in Next.js metadata rendering,
  not the keyed application lists.
- **Health check fails:** verify both Neon URLs and inspect the build/runtime
  logs; readiness must be able to query PostgreSQL.
- **Port detection fails:** remove a manually configured `PORT`; retain
  `HOSTNAME=0.0.0.0`.
- **Uploads fail:** use the R2 S3 endpoint for signing, the Worker URL only for
  public delivery, and allow the exact Render origin in R2 CORS.
- **Emails do not arrive:** this is expected on Render Free because SMTP ports
  are blocked. Do not repeatedly rotate valid Gmail credentials for this error.
- **Auth links or redirects use localhost:** update `APP_URL` and
  `CORS_ORIGINS` together, then redeploy.
- **A new `sync: false` variable is added later:** add it manually to the
  existing service because Blueprint sync does not prompt again.
