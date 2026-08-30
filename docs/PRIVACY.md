# Privacy — Data Lifecycle, Export, Deletion, and Log Redaction

How the DTG platform handles personal data across its lifetime. Every constant
cited here is code-anchored (file + symbol) so this document cannot silently
drift; the quarterly audit (§6) re-verifies each anchor.

## 1. Retention schedule

| Data | Retention | Anchor |
| --- | --- | --- |
| Contact submission bodies | Bodies purged after **90 days**; rows kept (no PII) for abuse-rate accounting | `CONTACT_RETENTION_DAYS` in `src/contracts/support.ts`; `purgeExpiredContactBodies` in `src/server/modules/support/contact.service.ts` |
| Export job content | Downloadable for **24 h** after completion, then EXPIRED (content purged; piggyback sweep) | `EXPORT_TTL_HOURS` in `src/contracts/owner-ops.ts`; expiry math in `src/server/modules/owner/exports.logic.ts` |
| Outbox events | Retryable failures re-scheduled with exponential backoff, **30 s base / 15 min cap**; COMPLETED retained for audit; permanent failures FAILED | `BACKOFF_BASE_MS`/`BACKOFF_MAX_MS` in `src/server/modules/notifications/outbox.dispatcher.ts` |
| Sessions | **7 days** expiry, refreshed daily | `session.expiresIn: 7 * DAY_IN_SECONDS, updateAge: DAY_IN_SECONDS` in `src/server/auth/auth.ts` |
| Verification tokens | **1 hour** expiry; stored **hashed** | `emailVerification.expiresIn: 60 * 60` + `verification.storeIdentifier: "hashed"` in `src/server/auth/auth.ts`; `issueEmailVerificationToken` |
| Email suppression list | Permanent (opt-out integrity) | `EmailSuppression` model; `sendWithSuppressionCheck` in `src/server/email/email-port.ts` |
| Audit log | Retained (security/integrity); PII-minimal by design | `AuditLog` model; write helper in `src/server/modules/owner/audit.service.ts` |

## 2. Log and trace PII redaction

The structured logger (`src/server/observability/logger.ts`, shared redactor
in `src/server/observability/redact.ts`) drops every value whose KEY matches
`authorization | cookie | password | secret | token | access.?key |
database.?url` and replaces it with `[REDACTED]`. Error objects are reduced to
name/message/stack.

Hard rule enforced by review and by the unit tests: **email addresses are
never logged whole** — spans carry the recipient DOMAIN only (e.g.
`email.send` span in `src/server/email/email-port.ts`), and no code path logs
`user.email`. `captureError` (`src/server/observability/error-monitor.ts`)
applies the same redactor to arbitrary error payloads.

## 3. User data export (subject access)

- Endpoint: `GET /api/v1/account/export` — authenticated (session cookie),
  rate-limited by the `accountSensitive` policy, returns
  `application/json` attachment `dtg-account-export-<yyyy-mm-dd>.json`.
- Document shape (contract `accountExportSchema` in
  `src/contracts/accounts.ts`): identity + profile (+ notification prefs),
  enrolments, lesson progress, private notes, discussion threads/posts, quiz
  attempt summaries, assignment submissions, certificates, orders + payments
  (status/amount only), reviews. Provider webhook payloads and quiz answer
  keys are deliberately excluded.
- The export is generated from the user's own rows only (every query is pinned
  to the caller id) and contains nothing the user could not see in the UI.

## 4. Account deletion / anonymization (policy v1)

Triggered by `POST /api/v1/account/delete` with the typed confirmation
`DELETE` (enforced twice: schema check + `evaluateDeletionConfirmation`).
Owner accounts cannot self-delete (`OWNER_DELETE_FORBIDDEN`, 422). The whole
operation is one transaction in `deleteAccount`
(`src/server/modules/accounts/accounts.service.ts`) plus one audit row
(`account.deleted`, metadata `{retentionPolicy: "v1"}`).

| What | Outcome | Why |
| --- | --- | --- |
| `User.name`, `email`, `emailNormalized` | Deterministically anonymized: `Deleted User`, `deleted-<userId8>@deleted.invalid` (unique per user, so UNIQUE constraints hold on replay) | Identity erasure; determinism keeps reruns idempotent |
| `User.image`, `status`, `deletedAt` | image null, status `DELETED`, deletedAt set | Login/visibility killed at the guard (`requireAuthenticatedUser` rejects non-ACTIVE) |
| `Profile` | displayName `Deleted User`; bio, countryCode, avatarKey cleared; locale reset | Profile erasure |
| Sessions, auth Accounts, Verifications | Deleted | Credential destruction; existing cookies 401 immediately |
| Notifications, lesson notes | Deleted | Personal content erasure |
| Enrolments, orders, payments, certificates, reviews, quiz/assignment records | **Retained**, now pointing at an anonymized user | Financial/tax records, certificate revocation capability, review/rating aggregate integrity, grading history |
| Audit log row (`account.deleted`) | Written | Privacy audit trail |

Consequence (accepted, documented): reviews and discussion posts authored
before deletion remain visible with the author showing as the anonymized
account; certificates issued before deletion remain verifiable unless revoked
through the owner console.

## 5. Consent and notification preferences

The four learner-facing toggles (`emailNotifications`, `courseUpdates`,
`newContent`, `promotionalEmails`) live in `Profile.notificationPrefs` (JSONB,
partial document; missing keys read as `NOTIFICATION_PREFS_DEFAULTS` in
`src/contracts/accounts.ts`). They are read by the notification/emission layer
— flipping `emailNotifications` off stops transactional notification emails
for that user (in-app rows still accrue, subject to `EmailSuppression` for
marketing sends).

## 6. Quarterly privacy audit procedure

1. **Redaction**: run the full suite — `redact` coverage
   (`tests/unit/error-monitor.test.ts`) and logger tests must pass; grep the
   codebase for `logger.*email` and confirm no whole-address logging crept in.
2. **Suppression**: confirm `sendWithSuppressionCheck` remains the only send
   gateway (`rg "sendMail\(" src/` → only email-port.ts).
3. **Access**: verify export/delete endpoints still require authentication and
   are rate-limited (route files + OpenAPI `security` entries).
4. **Deletion**: run one sandbox deletion drill; verify the anonymized email
   shape, revoked sessions (old cookie → 401), and the audit row.
5. **Retention**: confirm the contact-body purge and export sweep constants
   match §1 (anchor files unchanged).
6. **Logs**: sample 20 recent error-log lines for accidental PII.
