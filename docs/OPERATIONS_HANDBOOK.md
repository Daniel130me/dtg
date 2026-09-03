# Operations Handbook — DTG Learning Platform

The launch-ready operating manual: what the service is, how to deploy it, how
to watch it, what to do when it breaks, and how a reviewer verifies it. This
document is the **entry point** into the doc set — the specialized runbooks
listed in §9 carry the detail and are referenced, never duplicated.

Every constant cited here is code-anchored so this document cannot silently
drift. If a threshold changes in code, change the citation in the same commit.

---

## 1. System overview

| Layer | Technology | Notes |
| --- | --- | --- |
| Web app | Next.js 16 (App Router) + React 19, TypeScript 5 | Serves the public site, student learning UI, and owner console |
| API | Next.js Route Handlers under `/api/v1/**` | Contract-first; machine-readable OpenAPI at `GET /api/v1/openapi.json` |
| Database | PostgreSQL (Neon in production) via Prisma ORM | Pooled URL for traffic (`DATABASE_URL`), direct URL for migrations (`DIRECT_URL`) |
| Auth | Better Auth (email/password, Argon2 hashes, session cookies) | Sessions expire in 7 days, refreshed daily (see `docs/PRIVACY.md` §1) |
| Payments | Flutterwave (secret key + webhook hash) | Optional at boot; both halves required together (see §3) |
| Email | SMTP via Nodemailer | Optional at boot; dev falls back to structured log delivery |
| Object storage | Cloudflare R2 | Direct thumbnail uploads and private multipart lecture-video uploads; assignment attachments remain a documented seam (`docs/RECOVERY_RUNBOOK.md` §3) |
| Runtime shape | Cloud Run web service plus migration/outbox jobs; Render remains a supported fallback | Primary delivery is in `docs/GCP_CLOUD_RUN_DEPLOYMENT.md`; Render steps remain in `docs/RENDER_DEPLOYMENT.md` |

**Request path:** browser → Next.js route handler (`executeRoute` wrapper:
request id, structured log line, metrics sample, rate limiting, Zod validation)
→ service module → Prisma → Postgres. Domain mutations that trigger
notifications/emails write `OutboxEvent` rows transactionally; the dispatcher
projects them into in-app notifications (durable, deduplicated by `eventKey`)
and best-effort email.

**Trust boundaries:** session cookie for `/account/*`, `/learning/*`; `OWNER`
role for `/owner/*`, `/metrics`, `/health/diagnostics`; HMAC-SHA256 webhook
hash for the Flutterwave callback; CSRF origin gate on mutating browser
requests (`assertAllowedOrigin`, covered by `tests/unit/security.test.ts`).

---

## 2. Deployment

### 2.1 Prerequisites

1. Neon project with a protected production branch and PITR window ≥ 7 days —
   verify per `docs/RECOVERY_RUNBOOK.md` §2 before the first deploy.
2. Secret manager entries for every variable in `.env.example` (the example
   file is the canonical list and is kept in sync with
   `src/server/config/env.ts`).
3. Node 24 LTS (matches the CI toolchain; `package.json` declares `npm@11`).

### 2.2 Deploy sequence

Cloud Build executes the production sequence declared in `cloudbuild.yaml`:
build immutable web/job images, run the migration job, deploy the web service,
then configure the outbox job. See `docs/GCP_CLOUD_RUN_DEPLOYMENT.md` for the
beginner setup and first-deploy guide. Render remains deployable from
`render.yaml`; its separate guide documents that fallback.

```bash
# 1. Pre-flight (fails the deploy on drift/pending migrations)
bunx prisma migrate status
bunx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --exit-code

# 2. Apply schema
bunx prisma migrate deploy

# 3. Build and start
npm run build
npm start
```

### 2.3 First-deploy provisioning (one-time)

```bash
ALLOW_OWNER_BOOTSTRAP=true \
OWNER_EMAIL=owner@example.com \
OWNER_DISPLAY_NAME="Platform Owner" \
OWNER_PASSWORD='<generated secret>' \
npm run owner:bootstrap
```

`ALLOW_OWNER_BOOTSTRAP` defaults to false; provisioning is idempotent and
refuses to run twice (`provisionInitialOwner` in
`src/server/modules/owner/owner.service.ts`). **Remove the bootstrap env block
from the secret manager after provisioning.**

### 2.4 Post-deploy verification (mandatory gate)

```bash
npm run smoke -- https://<app-url>
# or: APP_URL=https://<app-url> npm run smoke
```

The smoke script is cookie-free, read-only, and idempotent. It checks:

| Check | Expectation |
| --- | --- |
| `health/live`, `health/ready` | 200 with `data` key |
| Course catalog list, category list | 200 with `data` key |
| OpenAPI document | 200 with `openapi` key |
| `/auth/me`, `/account/profile` | 401 (session-gated) |
| `/metrics` | 401 (owner-gated) |

Exit 0 = deploy accepted; exit 1 = roll back or fix forward (§5.3). The same
script is the acceptance gate after a database restore
(`docs/RECOVERY_RUNBOOK.md` §5.1.6).

---

## 3. Configuration reference

Validation is centralized in `src/server/config/env.ts` (Zod). The process
**refuses to boot** on invalid config; health/live cannot mask it. Groups:

| Group | Variables | Boot behavior |
| --- | --- | --- |
| Core | `NODE_ENV`, `APP_URL`, `PORT`, `LOG_LEVEL`, `DB_READINESS_TIMEOUT_MS` | Defaults exist; APP_URL drives absolute links in emails |
| Database | `DATABASE_URL` (must be `postgresql://`), `DIRECT_URL`, `TEST_DATABASE_URL` | `DATABASE_URL` is **required** |
| HTTP security | `CORS_ORIGINS`, `TRUSTED_PROXY_PROVIDER`, `RATE_LIMIT_SALT`, `BETTER_AUTH_SECRET` | Select the actual hosting proxy; salt/secret must not match development placeholders |
| Observability | `RELEASE_ID` (falls back to package version), `METRICS_ENABLED` (default true; gates `/metrics` endpoint, collection stays on) | |
| R2 | `R2_BUCKET`, `R2_S3_ENDPOINT`, `R2_PUBLIC_BASE_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Optional; media features degrade until configured. `R2_S3_ENDPOINT` must use `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; the public Worker/custom domain belongs in `R2_PUBLIC_BASE_URL`. |
| SMTP | `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | All-or-nothing: partial config fails boot; absent config = logged mail delivery |
| Flutterwave | `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH` | All-or-nothing: partial config fails boot (prevents paid checkout without verifiable webhooks) |

Browser-to-R2 thumbnail and multipart lecture uploads also require a bucket
CORS policy. Allow only the deployed application origins, the `PUT` method,
and the `Content-Type` header; expose `ETag` (multipart completion requires
each part ETag) and keep the preflight cache bounded. Example:

```json
[
  {
    "AllowedOrigins": ["https://your-app.example"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Lecture videos accept MP4/WebM files up to 20 GB. The browser uploads 16 MB
parts directly to R2 with four concurrent requests and three attempts per
part; the application server never buffers video bytes. Uploaded lectures
remain private and the learning API issues a six-hour signed playback URL only
after the enrolment or preview access check. Keep R2's seven-day incomplete
multipart lifecycle so abandoned parts do not accumulate storage charges.
The public Worker/custom domain must allow only thumbnail object prefixes; it
must deny `courses/*/lessons/*`. Do not attach an unrestricted public domain to
the bucket, because paid lecture playback depends on signed S3 GET URLs.

Set `TRUSTED_PROXY_PROVIDER` to the actual hosting edge (`cloudflare` for
Render or `cloud-run` for Google Cloud Run). Use `none` locally. The legacy
`TRUST_PROXY_HEADERS` boolean remains for compatibility but must not be used
for new deployments.

---

## 4. Health, metrics, and alerts

### 4.1 Endpoints

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/v1/health/live` | public | Process is up; reports `shuttingDown` flag during drain |
| `GET /api/v1/health/ready` | public | Database reachable within `DB_READINESS_TIMEOUT_MS` (10 s default) |
| `GET /api/v1/health/diagnostics` | **OWNER** | Dependency matrix: DB latency, SMTP/R2/payments config, outbox/webhook lag, job failures |
| `GET /api/v1/metrics` | **OWNER**, `METRICS_ENABLED` | Full scrape: registry snapshot (histogram + counters), queue gauges, evaluated alerts |

### 4.2 Alert conditions (evaluated on every `/metrics` scrape)

| Alert | Fires when | Threshold anchor | First action |
| --- | --- | --- | --- |
| `http_5xx_error_rate` | > 5% of the last ≥ 20 requests returned 5xx | `HTTP_ERROR_RATE_THRESHOLD`, `metrics.ts` | Check logs for the failing route; §5.2 |
| `webhook_signature_failures` | ≥ 5 signature failures in 15 min | `WEBHOOK_SIGNATURE_FAILURE_THRESHOLD` | Possible forgery or hash mismatch — verify `FLUTTERWAVE_WEBHOOK_HASH` before anything else |
| `outbox_oldest_pending_age_seconds` | Oldest pending outbox event > 300 s | `OUTBOX_LAG_ALERT_THRESHOLD_SECONDS` | Dispatcher not running — run `POST /api/v1/owner/outbox/dispatch` (§6.1) |
| `job_failures` | > 10 job failures in 15 min | `JOB_FAILURE_ALERT_THRESHOLD` | Inspect error-monitor log lines for the failing job type |

### 4.3 Getting alerts into an owned channel

The in-repo seam is the metrics snapshot: scrape `GET /api/v1/metrics` with an
owner session from a scheduled worker (cron ≥ every 5 min), evaluate the
`alerts` array, and forward non-empty results to Slack/PagerDuty/email. A
minimal external worker (Cloudflare Worker / GitHub Action on schedule) is the
intended attachment point; runbooks assume alerts arrive through that channel.
Until it is wired, the documented fallback is a manual scrape at the top of
every business-day shift (§7 duty checklist).

---

## 5. Incident response

### 5.1 Severity ladder

| Sev | Definition | Response |
| --- | --- | --- |
| S1 | Service unreachable, or data loss suspected, or payment integrity in question | Immediate; page owner; restore path (§5.3) |
| S2 | Core flows degraded (checkout, enrolment, learning) or alerts firing > 30 min | Same business day; mitigations in §5.4 |
| S3 | Non-core degradation (email lag, single non-critical route failing) | Next business day |

### 5.2 First 10 minutes (any incident)

1. `GET /health/live` and `/health/ready` — is the process up? Is Postgres reachable?
2. `GET /health/diagnostics` (owner) — which dependency is degraded?
3. `GET /metrics` (owner) — which alerts fired? Check `http_request_duration_ms` p99.
4. Grep structured logs by `requestId` from the failing request lines; every
   route log line carries it (`src/server/http/request-context.ts`).
5. If a deploy preceded the incident, assume the deploy is the cause — see §5.3.

### 5.3 Rollback / forward-fix

- **App-only regression:** redeploy the previous release (git tag per release;
  `RELEASE_ID` stamps every log line and metric snapshot so you know exactly
  what is running). Migrations are expand-only per `docs/MIGRATION_RUNBOOK.md`
  §2 — a previous app version is always compatible with the current schema.
- **Failed migration mid-deploy:** follow the failure-mode table in
  `docs/MIGRATION_RUNBOOK.md` §3 (`migrate resolve --rolled-back` after
  fixing, never `migrate reset` in production).
- **Data loss / corruption:** execute `docs/RECOVERY_RUNBOOK.md` §5 (Neon
  branch restore) end to end; the smoke script is the acceptance gate.

### 5.4 Playbooks by symptom

| Symptom / alert | Likely cause | Play |
| --- | --- | --- |
| `/health/ready` 200→fail, courses 500 | Postgres down / connection exhaustion | Check Neon console; verify pooled URL; scale compute; S1 if > 5 min |
| `http_5xx_error_rate` on one route | Code regression after deploy | §5.3 rollback; capture `requestId` examples for the fix |
| `webhook_signature_failures` | Misconfigured hash **or** forgery attempt | Confirm hash secret; if confirmed forgery, block source, audit payments for tampering, S1 |
| `outbox_oldest_pending_age_seconds` | Dispatcher not scheduled | Trigger `POST /api/v1/owner/outbox/dispatch` manually; fix the cron; check `job_failures` |
| Emails not arriving | SMTP creds expired / suppression list | `/health/diagnostics` SMTP section; check `EmailSuppression` rows; outbox FAILED events hold the error |
| 429 storm on auth routes | Brute force | Rate limiting is active by policy (`rate-limit-policies.ts`); inspect source IPs in logs; consider CORS/IP block at edge |
| Refund/fulfilment dispute | Payment state divergence | Use `POST /api/v1/payments/orders/[orderId]/reconcile` and owner refund endpoint; audit trail in `AuditLog` |

---

## 6. Routine operations

| Cadence | Task | How |
| --- | --- | --- |
| Every minute (scheduler) | Outbox dispatch (notifications + emails + contact-body purge piggyback) | Cloud Scheduler executes the `dtg-outbox` Cloud Run job; Render cron is the fallback. Leases and dedupe keys make retries safe. |
| Daily (or per scrape) | Alert check | §4.3 |
| Weekly | `bunx prisma migrate status` on production (expect: no pending) | CI gate also enforces per deploy |
| Quarterly | Backup posture re-verify | `docs/RECOVERY_RUNBOOK.md` §2 |
| Quarterly | Restore drill (executed, not just read) | `docs/RECOVERY_RUNBOOK.md` §5 — this satisfies the plan's "restore procedure executed" gate |
| Quarterly | Dependency audit | `npm audit --omit=dev` + license review of `dependencies` (Phase 12 ran the baseline; resolve launch-blocking findings immediately, others within a sprint) |
| Quarterly | Privacy audit re-verification | `docs/PRIVACY.md` §6 |
| On demand | Expired export sweep | Piggybacks on `GET /api/v1/owner/exports` (list read runs it); no cron needed |
| On demand | Expired contact-body purge | Piggybacks on the outbox dispatcher run |

---

## 7. On-call duty checklist (per shift)

1. Scrape `/metrics` (owner session): any alerts? p99 latency trend?
2. Sample `/health/diagnostics`: DB latency sane, outbox lag < 5 min?
3. Skim error-monitor log lines since last shift (`release` id separates deploys).
4. Confirm the outbox cron actually ran in the last hour (oldest pending age).

---

## 8. Reviewer guide

**How to verify this platform end to end without reading all of it:**

1. **Contract surface:** open `GET /api/v1/openapi.json` — every route under
   `src/app/api/v1/**` is registered, with auth requirements and error
   envelopes. `tests/unit/openapi.test.ts` fails the suite if registration
   drifts.
2. **Demo accounts (local/preview only):** create isolated reviewer accounts
   with generated passwords. Never seed or document production credentials.
3. **Quality gates:** `npm run lint && npm run typecheck && npm test`
   (unit + integration suites, 331 tests at Phase 12 close). Tests are
   provider-independent; DB-touching suites need a Postgres
   `DATABASE_URL`/`TEST_DATABASE_URL` (the sqlite URL injected into sandbox
   shells trips env validation by design — that is the validator working).
4. **Smoke:** `npm run smoke -- <base-url>` after any deploy or restore.
5. **Security posture:** `tests/unit/security.test.ts` covers the OWASP API
   slice implemented in-code (CSRF origin gate, BOLA owner guards, mass
   assignment, payload limits, secret hygiene in logs); rate-limit abuse
   verification in `tests/integration/rate-limit.test.ts`.
6. **Load:** `tests/load/loadtest.ts` (catalog / categories / health / detail
   anonymous + authenticated dashboard / login POST loop) — see file header
   for usage and thresholds before interpreting results.
7. **Doc map (§9):** every launch-facing claim traces to a runbook that is
   reviewed in the same PR discipline as code.

**Reviewer reading order for the backend:** `src/contracts/**` (DTOs and
constants) → `src/server/http/route-handler.ts` (the one request pipeline) →
one service module end-to-end (e.g. `src/server/modules/enrolments/`) →
`tests/unit/<same area>.test.ts`. That path shows the house style: contract
constants, no magic values, budgeted queries, and tests as executable
documentation.

---

## 9. Document map

| Document | Scope |
| --- | --- |
| `docs/BACKEND_SETUP.md` | Local development environment from zero |
| `docs/RENDER_DEPLOYMENT.md` | Render Blueprint, production secrets, CI/CD, verification, and rollback |
| `docs/GCP_CLOUD_RUN_DEPLOYMENT.md` | Beginner Cloud Run setup, IAM, secrets, CI/CD, jobs, verification, and rollback |
| `docs/BACKEND_IMPLEMENTATION_PLAN.md` | The 13-phase build plan with acceptance checkboxes |
| `docs/MIGRATION_RUNBOOK.md` | Deployment checks, expand/contract policy, failure modes |
| `docs/RECOVERY_RUNBOOK.md` | Neon PITR/restore objectives, R2 policy, restore drill |
| `docs/PRIVACY.md` | Retention schedule, export/deletion, log redaction anchors |
| `docs/ANALYTICS_METRICS.md` | Formula contracts for every owner-facing metric |
| `docs/OPERATIONS_HANDBOOK.md` | This document — deployment, alerts, incident response, reviewer guide |

---

## 10. Known limitations and launch deviations (deliberate, documented)

| Area | State | Consequence / seam |
| --- | --- | --- |
| R2 assignment attachments | Not implemented | Course thumbnails and lecture videos are implemented; assignment attachments remain a documented seam (`docs/RECOVERY_RUNBOOK.md` §3) |
| SMTP | Optional at boot | Unset = emails logged, not sent; suppression list still honored |
| Flutterwave | Optional at boot | Unset = checkout disabled; set both key + hash or the process refuses to start |
| External alert channel | Worker is an external seam | §4.3 defines the scrape contract; until wired, manual shift checks (§7) |
| Error monitoring | In-repo (logger + error monitor + `/metrics`) | Sentry/OTel collector attachment is a config-time seam, documented here; no PII leaves the process by default (PII redaction per `docs/PRIVACY.md` §2) |
| Load/security tests | Offline suites, not CI load runs | Run before launch against a production-like dataset; thresholds in file headers |
| Outbox dispatcher | Cloud Scheduler executes a bounded Cloud Run job every minute; Render cron remains supported | Monitor job exits and outbox lag; the owner endpoint remains an emergency manual trigger |

Deployment status (2026-09-02): the production Neon project is wired (`DATABASE_URL` pooled / `DIRECT_URL` direct), R2 (bucket `dtg`) and SMTP (Gmail, port 587 STARTTLS) are configured and verified end-to-end via `scripts/verify-r2.ts` (S3 round-trip + public `r2.dev` delivery) and `scripts/verify-smtp.ts` (auth + one labelled test email). Flutterwave and the external alert channel remain the open seams.
