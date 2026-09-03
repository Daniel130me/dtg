#!/usr/bin/env bash
set -Eeuo pipefail
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

PROJECT_ID="${1:?project id is required}"
REGION="${2:?region is required}"
REPOSITORY="${3:?artifact repository is required}"
COMMIT_SHA="${4:?commit sha is required}"
SERVICE="${5:?service name is required}"
MIGRATION_JOB="${6:?migration job name is required}"
OUTBOX_JOB="${7:?outbox job name is required}"

RUNTIME_SERVICE_ACCOUNT="dtg-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
WEB_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/web:${COMMIT_SHA}"
JOBS_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/jobs:${COMMIT_SHA}"

latest_enabled_version() {
  local secret_name="$1"
  local version_name
  version_name="$(gcloud secrets versions list "$secret_name" \
    --project="$PROJECT_ID" \
    --filter='state=ENABLED' \
    --sort-by='~createTime' \
    --limit=1 \
    --format='value(name)')"

  if [[ -z "$version_name" ]]; then
    echo "Secret $secret_name has no enabled version." >&2
    return 1
  fi
  printf '%s' "${version_name##*/}"
}

secret_ref() {
  local env_name="$1"
  local secret_name="$2"
  printf '%s=%s:%s' "$env_name" "$secret_name" "$(latest_enabled_version "$secret_name")"
}

# Pin each secret to the newest enabled numeric version at deployment time.
# This prevents instances of one revision from observing different secret
# values if an operator rotates a Secret Manager `latest` version mid-release.
MIGRATION_SECRETS="$(secret_ref DATABASE_URL dtg-database-url),$(secret_ref DIRECT_URL dtg-direct-url)"
WEB_SECRETS="$(secret_ref APP_URL dtg-app-url),$(secret_ref CORS_ORIGINS dtg-cors-origins),$(secret_ref DATABASE_URL dtg-database-url),$(secret_ref DIRECT_URL dtg-direct-url),$(secret_ref RATE_LIMIT_SALT dtg-rate-limit-salt),$(secret_ref BETTER_AUTH_SECRET dtg-auth-secret),$(secret_ref OWNER_EMAIL dtg-owner-email),$(secret_ref R2_BUCKET dtg-r2-bucket),$(secret_ref R2_S3_ENDPOINT dtg-r2-s3-endpoint),$(secret_ref R2_PUBLIC_BASE_URL dtg-r2-public-base-url),$(secret_ref R2_ACCESS_KEY_ID dtg-r2-access-key-id),$(secret_ref R2_SECRET_ACCESS_KEY dtg-r2-secret-access-key),$(secret_ref EMAIL_FROM dtg-email-from),$(secret_ref SMTP_HOST dtg-smtp-host),$(secret_ref SMTP_PORT dtg-smtp-port),$(secret_ref SMTP_USER dtg-smtp-user),$(secret_ref SMTP_PASSWORD dtg-smtp-password)"
OUTBOX_SECRETS="$(secret_ref APP_URL dtg-app-url),$(secret_ref DATABASE_URL dtg-database-url),$(secret_ref RATE_LIMIT_SALT dtg-rate-limit-salt),$(secret_ref BETTER_AUTH_SECRET dtg-auth-secret),$(secret_ref EMAIL_FROM dtg-email-from),$(secret_ref SMTP_HOST dtg-smtp-host),$(secret_ref SMTP_PORT dtg-smtp-port),$(secret_ref SMTP_USER dtg-smtp-user),$(secret_ref SMTP_PASSWORD dtg-smtp-password)"

gcloud run jobs deploy "$MIGRATION_JOB" \
  --project="$PROJECT_ID" \
  --image="$JOBS_IMAGE" \
  --region="$REGION" \
  --service-account="$RUNTIME_SERVICE_ACCOUNT" \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=10m \
  --command=npm \
  --args=run,db:migrate:deploy \
  --update-secrets="$MIGRATION_SECRETS"

gcloud run jobs execute "$MIGRATION_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --wait

gcloud run deploy "$SERVICE" \
  --project="$PROJECT_ID" \
  --image="$WEB_IMAGE" \
  --region="$REGION" \
  --service-account="$RUNTIME_SERVICE_ACCOUNT" \
  --allow-unauthenticated \
  --ingress=all \
  --port=8080 \
  --cpu=1 \
  --memory=1Gi \
  --concurrency=40 \
  --min=1 \
  --max=10 \
  --timeout=300 \
  --cpu-boost \
  --update-env-vars="NODE_ENV=production,NEXT_TELEMETRY_DISABLED=1,DB_READINESS_TIMEOUT_MS=4000,LOG_LEVEL=info,METRICS_ENABLED=true,TRUSTED_PROXY_PROVIDER=cloud-run,RELEASE_ID=${COMMIT_SHA}" \
  --update-secrets="$WEB_SECRETS" \
  --startup-probe="httpGet.path=/api/v1/health/ready,httpGet.port=8080,initialDelaySeconds=0,timeoutSeconds=4,periodSeconds=5,failureThreshold=24" \
  --liveness-probe="httpGet.path=/api/v1/health/live,httpGet.port=8080,initialDelaySeconds=10,timeoutSeconds=2,periodSeconds=10,failureThreshold=3"

gcloud run jobs deploy "$OUTBOX_JOB" \
  --project="$PROJECT_ID" \
  --image="$JOBS_IMAGE" \
  --region="$REGION" \
  --service-account="$RUNTIME_SERVICE_ACCOUNT" \
  --tasks=1 \
  --max-retries=0 \
  --task-timeout=10m \
  --command=npm \
  --args=run,jobs:outbox \
  --update-env-vars="NODE_ENV=production,LOG_LEVEL=info,RELEASE_ID=${COMMIT_SHA}" \
  --update-secrets="$OUTBOX_SECRETS"
