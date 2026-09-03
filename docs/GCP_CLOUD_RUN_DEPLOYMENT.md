# Google Cloud Run production deployment

This is a first-time-friendly guide. Follow it in order and do not skip the
credential-rotation or CI verification steps. The existing Render files remain
valid and independent, so returning to Render later does not require reverting
this setup.

## What will be created

| Resource | Purpose |
| --- | --- |
| Cloud Run service `dtg-learning-platform` | Public Next.js application |
| Cloud Run job `dtg-database-migrate` | Applies committed Prisma migrations before each release |
| Cloud Run job `dtg-outbox-dispatch` | Sends queued notifications and email, then exits |
| Cloud Scheduler job | Starts the outbox job every minute |
| Artifact Registry repository `dtg` | Stores immutable web and job images |
| Secret Manager secrets | Holds Neon, R2, SMTP, auth, and application configuration |
| Three service accounts | Separate runtime, build, and scheduler permissions |
| GitHub Workload Identity Federation | Gives CI short-lived Google credentials without a JSON key |

The default region is `europe-west2` (London), close to the existing Neon
database. The web service uses 1 vCPU, 1 GiB memory, concurrency 40, one warm
instance, and a maximum of ten instances. Start with these conservative limits
and change them only after observing production latency, memory, and database
connection use.

## 1. Secure the provider credentials

Revoke and recreate every Neon password, R2 token, and Gmail app password that
has previously appeared in a chat, screenshot, issue, or log. Never put a
credential in this repository, a Docker build argument, or a GitHub variable.
The deployment uses Secret Manager references, so secrets do not enter image
layers or Cloud Build logs.

## 2. Create a Google Cloud project

1. Open the Google Cloud Console and select **New project**.
2. Give it a recognizable name such as `DTG Production` and note its immutable
   **Project ID**. The display name and Project ID are different.
3. Attach a billing account.
4. Open **Billing → Budgets & alerts** and create a small monthly budget alert
   before creating compute resources.
5. Click the terminal icon in the console header to open **Cloud Shell**. All
   commands in sections 2–5 run there; you do not need to install `gcloud` on
   your Windows computer.

In Cloud Shell, replace the value on the first line and run:

```bash
export PROJECT_ID="your-real-project-id"
export REGION="europe-west2"
gcloud config set project "$PROJECT_ID"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  logging.googleapis.com
```

`export` values last only for the current Cloud Shell session. Re-run the first
two lines after reopening Cloud Shell.

## 3. Create the image repository and service accounts

```bash
gcloud artifacts repositories create dtg \
  --repository-format=docker \
  --location="$REGION" \
  --description="DTG production container images"

gcloud iam service-accounts create dtg-runtime \
  --display-name="DTG Cloud Run runtime"
gcloud iam service-accounts create dtg-cloud-build \
  --display-name="DTG Cloud Build deployer"
gcloud iam service-accounts create dtg-scheduler \
  --display-name="DTG outbox scheduler"
```

Grant only the required project-level roles:

```bash
for ROLE in artifactregistry.writer run.admin logging.logWriter secretmanager.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:dtg-cloud-build@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/$ROLE"
done

gcloud iam service-accounts add-iam-policy-binding \
  "dtg-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:dtg-cloud-build@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding \
  "dtg-cloud-build@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-cloudbuild.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:dtg-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 4. Create secrets

Open **Security → Secret Manager** in the Google Cloud Console. Click
**Create secret** once for every name below. Paste only the value, with no
surrounding quotation marks.

| Secret name | Value |
| --- | --- |
| `dtg-app-url` | Initially `https://pending.invalid`; replace after the first deployment |
| `dtg-cors-origins` | Initially `https://pending.invalid`; later exactly the public app origin |
| `dtg-database-url` | Neon pooled URL for application traffic |
| `dtg-direct-url` | Neon direct URL for Prisma migrations |
| `dtg-rate-limit-salt` | At least 32 random characters, unique to this application |
| `dtg-auth-secret` | At least 32 random characters, different from the rate-limit salt |
| `dtg-owner-email` | The single instructor's normalized email address |
| `dtg-r2-bucket` | `dtg` |
| `dtg-r2-s3-endpoint` | `https://<account-id>.r2.cloudflarestorage.com` |
| `dtg-r2-public-base-url` | HTTPS Worker or custom-domain delivery origin |
| `dtg-r2-access-key-id` | New bucket-scoped R2 access-key ID |
| `dtg-r2-secret-access-key` | New bucket-scoped R2 secret key |
| `dtg-email-from` | For example `DTG <owner@example.com>` |
| `dtg-smtp-host` | `smtp.gmail.com` |
| `dtg-smtp-port` | `587` |
| `dtg-smtp-user` | Gmail account address |
| `dtg-smtp-password` | Newly generated Gmail app password |

The runtime service account already has Secret Accessor permission. Do not
grant that role to GitHub or to the scheduler service account.

If paid Flutterwave checkout is enabled, create `dtg-flutterwave-secret-key`
and `dtg-flutterwave-webhook-hash`. After the first deployment, attach both
without removing the base secrets:

```bash
gcloud run services update dtg-learning-platform \
  --region="$REGION" \
  --update-secrets="FLUTTERWAVE_SECRET_KEY=dtg-flutterwave-secret-key:1,FLUTTERWAVE_WEBHOOK_HASH=dtg-flutterwave-webhook-hash:1"
```

Secret versions are numeric on purpose. Each normal CI/CD deployment resolves
the newest enabled version and pins that number to the new revision, so one
running revision cannot change configuration midway through its lifetime.

## 5. Connect GitHub securely

The workflow intentionally uses Workload Identity Federation. Do not download
or create a service-account JSON key.

Set your exact GitHub owner and repository name, preserving case:

```bash
export GITHUB_REPOSITORY="your-github-owner/your-repository"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

gcloud iam workload-identity-pools create github \
  --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github \
  --location=global \
  --workload-identity-pool=github \
  --display-name="GitHub repository provider" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='${GITHUB_REPOSITORY}' && assertion.ref=='refs/heads/main'"

gcloud iam service-accounts create dtg-github-deployer \
  --display-name="DTG GitHub deployment submitter"

gcloud iam service-accounts add-iam-policy-binding \
  "dtg-github-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPOSITORY}"

for ROLE in cloudbuild.builds.editor storage.objectUser storage.bucketViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:dtg-github-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/$ROLE"
done

gcloud iam service-accounts add-iam-policy-binding \
  "dtg-cloud-build@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:dtg-github-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

In GitHub, open **Settings → Environments → New environment**, create
`production`, and add an approval rule if your GitHub plan supports it. Then
open **Settings → Secrets and variables → Actions** and add:

- Repository variable `GCP_PROJECT_ID`: your Project ID.
- Repository secret `GCP_DEPLOYER_SERVICE_ACCOUNT`:
  `dtg-github-deployer@<project-id>.iam.gserviceaccount.com`.
- Repository secret `GCP_WORKLOAD_IDENTITY_PROVIDER`:
  `projects/<project-number>/locations/global/workloadIdentityPools/github/providers/github`.

These two repository secrets are resource identifiers, not private keys, but
keeping them in the secrets section avoids unnecessary exposure.

## 6. First deployment

1. Push the prepared commit to `main` through a reviewed pull request.
2. GitHub runs the `CI` workflow first.
3. Only after CI passes, `Deploy Cloud Run` requests a short-lived Google token
   and submits `cloudbuild.yaml`.
4. Cloud Build creates two images, runs the migration job, deploys the healthy
   web revision, and updates the outbox job.
5. Open **Google Cloud → Cloud Build → History** to follow the first build.

The first deployment uses the temporary `.invalid` application origin. Obtain
the real URL after it succeeds:

```bash
export SERVICE_URL="$(gcloud run services describe dtg-learning-platform \
  --region="$REGION" --format='value(status.url)')"
echo "$SERVICE_URL"
```

In Secret Manager, open both `dtg-app-url` and `dtg-cors-origins`, click
**New version**, and save that exact HTTPS URL in each. Do not add a trailing
slash. Configure the same origin in the R2 bucket CORS policy.

In GitHub, open **Actions → CI**, copy the full commit SHA of the latest green
`main` run, then open **Deploy Cloud Run → Run workflow** and paste that SHA.
The workflow independently verifies that this SHA passed `CI` on `main`; it
will reject an arbitrary or untested revision. This second deployment starts
instances with the corrected origins.

## 7. Schedule notification and email delivery

After the outbox job exists, grant the scheduler permission on that job:

```bash
gcloud run jobs add-iam-policy-binding dtg-outbox-dispatch \
  --region="$REGION" \
  --member="serviceAccount:dtg-scheduler@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

gcloud scheduler jobs create http dtg-outbox-every-minute \
  --location="$REGION" \
  --schedule="* * * * *" \
  --time-zone="Etc/UTC" \
  --uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/dtg-outbox-dispatch:run" \
  --http-method=POST \
  --oauth-service-account-email="dtg-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"
```

Run it once immediately and inspect the job execution:

```bash
gcloud scheduler jobs run dtg-outbox-every-minute --location="$REGION"
gcloud run jobs executions list --job=dtg-outbox-dispatch --region="$REGION"
```

## 8. Verify production

From your development computer:

```bash
npm run smoke -- https://your-service-url.run.app
```

All nine checks must pass. Then manually verify registration email,
forgot-password email, owner login/settings, course creation, multipart video
upload, enrolment, lesson playback, progress, Q&A, and owner replies. If paid
checkout is enabled, update the Flutterwave webhook URL and perform its test
transaction flow.

## 9. Day-to-day CI/CD

Every push to `main` follows this order:

```text
GitHub CI → Cloud Build → immutable images → migration job
          → healthy Cloud Run revision → updated outbox job
```

If lint, types, tests, or the production build fail, deployment does not start.
If migration fails, the web revision is not deployed. The startup probe calls
the database-backed readiness endpoint before Cloud Run sends traffic. The
liveness probe restarts a wedged process without treating a temporary database
problem as a process crash.

Use expand-and-contract database migrations. Rolling the application back does
not reverse a schema migration.

## 10. Rollback and operations

List revisions:

```bash
gcloud run revisions list --service=dtg-learning-platform --region="$REGION"
```

In the Cloud Run console, open the service, choose **Revisions → Manage
traffic**, and send 100% back to the last known-good revision. Then fix forward.

Operational checks:

- Cloud Run service logs: request failures, startup, and shutdown.
- Cloud Run job executions: migrations and notification dispatch.
- Cloud Scheduler history: one successful trigger per minute.
- `/api/v1/health/ready`: Neon reachability.
- Owner-only `/api/v1/health/diagnostics` and `/api/v1/metrics`: dependency and
  queue health.
- Neon: connection count and compute utilization. Keep Cloud Run's maximum
  instances bounded until measurements justify increasing it.

The warm minimum instance prevents launch-time cold starts but creates a steady
charge. During pre-launch setup you can temporarily reduce it to zero:

```bash
gcloud run services update dtg-learning-platform --region="$REGION" --min=0
```

Restore `--min=1` before launch or allow the next CI/CD deployment to restore
the checked-in production setting.

## Troubleshooting

- **GitHub authentication fails:** confirm the provider uses the project
  number, the repository string matches exactly, and the run is from `main`.
- **Cloud Build cannot act as the runtime account:** repeat the
  `iam.serviceAccountUser` binding in section 3.
- **The migration job cannot read a secret:** confirm `dtg-runtime` has Secret
  Manager Secret Accessor and that both Neon secret names exist.
- **The service never becomes healthy:** inspect startup logs and verify the
  pooled Neon URL. The readiness probe has a four-second database timeout.
- **Auth redirects to `.invalid`:** add new versions of `dtg-app-url` and
  `dtg-cors-origins`, then manually redeploy the same green commit.
- **R2 uploads fail:** confirm the S3 endpoint is not the Worker URL and the API
  token has Object Read & Write access to only the `dtg` bucket.
- **Emails do not arrive:** inspect `dtg-outbox-dispatch` executions and verify
  all SMTP secrets, including the current Gmail app password.
