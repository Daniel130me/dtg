# Migration Runbook — Production Database Changes

Rules and procedures for every schema change shipped to the DTG platform
(Prisma + PostgreSQL/Neon). CI gate for every PR: `bunx prisma migrate status`
clean against production, `prisma migrate diff` shows no drift, and
`npm test` green (321 tests incl. integration suites that run migrations
against `TEST_DATABASE_URL`).

## 1. Deployment checks (before every deploy)

```bash
# 1. All local migrations committed and ordered after the latest applied one
bunx prisma migrate status

# 2. Schema <-> migrations have no drift (exit code 0 = in sync, 2 = drift)
bunx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code

# 3. Deploy (CI or release window)
bunx prisma migrate deploy
```

Fail the deploy if: status shows pending-but-unapplied migrations outside this
release, drift is detected (schema edited without a migration), or a migration
fails mid-apply. `migrate deploy` applies pending migrations in order and
records them in `_prisma_migrations`; a failed migration must be resolved with
`prisma migrate resolve --rolled-back <name>` after fixing, per the
failure-mode table below.

## 2. Expand-and-contract (the only allowed destructive pattern)

Five phases, at least one deploy between phases (two for busy tables):

1. **Expand** — additive migration: new nullable column, new table, new index
   (`CREATE INDEX CONCURRENTLY` for large tables; note that CONCURRENTLY
   cannot run inside a transaction — ship it as a separate non-transactional
   migration or apply manually with the lock timeout set).
2. **Backfill** — batched `UPDATE` (id-bounded batches of ~1k) behind a flag
   or one-off script; never one giant UPDATE on a live table.
3. **Switch reads** — code reads the new column/shape.
4. **Switch writes** — code writes the new column/shape.
5. **Contract** — separate migration drops the old column/index only after a
   full release cycle confirms nothing reads it.

Hard rules:

- Never RENAME or DROP in the same deploy that introduces the replacement.
- New columns are nullable first (or defaulted); NOT NULL arrives via a later
  phase after backfill, using `ADD CONSTRAINT ... NOT VALID` + `VALIDATE
  CONSTRAINT` for large tables.
- JSONB additive columns (e.g. `Profile.notificationPrefs`) are always safe:
  `ALTER TABLE ... ADD COLUMN ... JSONB;` — no backfill needed when the reader
  merges defaults (the accounts module does exactly this).
- Enum additions use `ALTER TYPE ... ADD VALUE` — this CANNOT run inside a
  transaction block in PostgreSQL < 12 semantics and cannot be conditional;
  keep it in its own migration and never inside `BEGIN/COMMIT` (Prisma wraps
  migrations in a transaction by default — add `-- prisma migration block`
  comment is NOT enough; use a non-tx migration via `prisma migrate diff
  --script` and verify with `migrate status`). The current enum set
  (UserRole, CourseStatus, LessonType/Status, UserStatus, EnrolmentStatus,
  EnrolmentSource, OrderStatus, PaymentStatus, RefundStatus,
  WebhookEventStatus, OutboxStatus, IdempotencyStatus, moderation/attempt
  enums) is considered frozen for launch.

## 3. Rollback vs forward-fix decision table

| Change | Rollback possible? | Action |
| --- | --- | --- |
| Additive column/table/index, not yet read by old code | Yes | `migrate resolve --rolled-back <name>` + drop the added object if it was applied |
| New nullable JSONB column | Yes | Same as above |
| Data backfill (UPDATE rows) | Usually NO | Forward-fix: compensating UPDATE scripted from the migration's audit trail |
| Enum value added | NO (cannot remove values) | Forward-fix only; the new code handling the value must ship reverted first |
| Constraint tightened / NOT NULL added | NO if writes violated it | Forward-fix: relax constraint, clean data, re-apply |
| Renamed column (phase 5 contract) | Forward-fix | Restore old name from the phase-1 duplicate |

Rollback of the APPLICATION (previous release image) is always possible and is
the first lever — application rollbacks are safe because contract phases keep
N-1 readers working until the contract phase completes.

## 4. Inventory of shipped migrations (one line each)

| Migration | Purpose | Special notes |
| --- | --- | --- |
| `20260828000100_foundation` | Core enums, User/Profile/PlatformSettings/AuditLog/IdempotencyKey/OutboxEvent + indexes | None |
| `20260828000300_authentication` | better-auth tables (Session/Account/Verification), hashed-token shape | Session token is a hash — unique index |
| `20260828000310_account_issuer` | Account uniqueness per (issuer, accountId) | Composite unique — credential identity |
| `20260829112848_courses_domain` | Categories/Courses/Sections/Lessons + publication indexes | None |
| `20260829130000_enrolments_commerce` | Enrolment/Order/Payment/Refund/WebhookEvent + money columns | Money stored in minor units (int) |
| `20260829130100_enrolment_order_item_unique` | Unique (orderId, courseId) order items | Bug-fix unique; forward-fix pattern applied |
| `20260829170000_learning_progress_notes_discussions` | LessonProgress/LessonNote/DiscussionThread/DiscussionPost + ordering constraints | Unique (enrolmentId, lessonId) progress |
| `20260830090000_assessments_certificates` | Quiz/attempt/question snapshots, assignment submissions, grades, certificates | Question-version snapshots are immutable |
| `20260831000000_phase10_engagement` | Review, Notification (dedupeKey UNIQUE), EmailSuppression, ContactSubmission | None |
| `20260901000000_phase11_owner_admin` | ExportJob + audit/support ops columns | None |
| `20260902000000_profile_notification_prefs` | `Profile.notificationPrefs JSONB` (additive) | Reader merges `NOTIFICATION_PREFS_DEFAULTS`; no backfill |

## 5. Failure drills

- **Migration hangs on lock**: it is waiting on a long-running query holding a
  lock. Do NOT kill-and-retry blindly; find the blocker
  (`pg_stat_activity` / `pg_locks`), terminate the idle-in-transaction
  session, let `migrate deploy` finish or re-run.
- **Partial apply then crash**: `migrate status` shows the failed migration;
  fix the SQL issue, `migrate resolve --rolled-back`, redeploy. Data written
  before failure is idempotent-safe only if the migration was written to be
  re-runnable — check before resolving.
- **Post-deploy validation failure**: run `scripts/smoke.ts` (health, catalog,
  auth-guard 401s, OpenAPI) and the §5 checks in docs/RECOVERY_RUNBOOK.md; a
  failed smoke after a migration is a forward-fix incident, not a redeploy.
