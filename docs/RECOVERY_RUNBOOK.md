# Recovery Runbook — Neon PostgreSQL + Object Storage

Applies to the DTG learning platform production deployment (Neon PostgreSQL is
the system of record; object storage is R2-planned, not yet configured — see
§3). Read this runbook BEFORE an incident. Verification queries in §5 and the
smoke checks (`scripts/smoke.ts`, delivered with Phase 12) are the post-restore
acceptance gate.

## 1. Objectives and scope

| Objective | Target | Mechanism |
| --- | --- | --- |
| RPO (max data loss) | ≤ 15 minutes | Neon PITR / history restore |
| RTO (max restore time) | ≤ 1 hour | Neon branch restore + config flip + smoke |
| Restore scope | Full database | One restore branch, one config flip |

Out of scope for automatic restore: transactional emails (re-send manually if
needed), in-flight outbox events at failure time (at-least-once delivery with
`eventKey` dedupe makes a short replay safe), and session tokens (users sign in
again — acceptable, documented here so nobody "restores" sessions).

## 2. Neon backup posture (verify quarterly and after any plan change)

Check in the Neon console for the production project/branch:

1. **PITR window ≥ 7 days** (History retention). Neon keeps WAL-based history;
   restore to any second inside the window.
2. **Protected branch** enabled for the production branch so accidental branch
   deletion cannot destroy the system of record.
3. **Connection strings** recorded in the secret manager: pooled URL
   (`DATABASE_URL`) and direct URL (`DIRECT_URL`) — migrations and batch jobs
   use the direct URL.
4. Compute size and autosuspend settings noted; restore performance depends on
   them.

If any of the above cannot be verified, treat the backup posture as FAILED and
file an incident before any deploy.

## 3. Object storage (R2) policy — pre-launch checklist

R2 is not configured in this deployment (uploads/certificate PDF storage are
documented deviations; certificates are generated with pdf-lib and delivered as
downloads, exports are DB-bounded CSV). The moment an R2 bucket goes live,
apply and verify:

1. **Versioning ON** for the bucket (overwrite mistakes are recoverable).
2. **Lifecycle rules**: expire noncurrent object versions after 30 days;
   abort incomplete multipart uploads after 7 days.
3. **Private bucket**: no public ACLs, no custom public domains; all reads via
   short-lived signed URLs from the application.
4. Access keys scoped to the single bucket, stored in the secret manager
   (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`), rotated quarterly.

## 4. Restore procedures

### 4.1 Point-in-time restore (primary path)

1. Freeze writes: suspend the Render `dtg-outbox-dispatch` cron job, then put
   the web service into maintenance or otherwise stop application writes.
2. Neon console → production branch → **Restore** → choose the timestamp
   (inside the PITR window). Neon creates a NEW branch at that point in time.
3. Note the restore branch connection strings (direct + pooled).
4. Update secrets: `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) → restore
   branch. Redeploy/restart the application so both are re-read.
5. Verify: `bunx prisma migrate status` must report "Database schema is up to
   date" with no pending migrations and no drift.
6. Run the smoke checks: `npm run smoke -- "$APP_URL"` (health,
   catalog, auth guards, OpenAPI). Section 5 adds the data-level checks.
7. After the soak period, name the restore branch as the new production
   branch (or update DNS/secrets to point at it permanently) and re-enable
   branch protection on it.

### 4.2 Full restore to a fresh branch (corrupted parent)

Same as 4.1, but choose "Restore from backup" instead of a timestamp. Neon
rebuilds from its most recent backup + available WAL. Everything else —
config flip, migration status, smoke — is identical.

### 4.3 Selective data repair (one table damaged, rest healthy)

Do NOT hand-edit production rows under pressure unless the incident lead
approves. Preferred: restore a PITR branch (4.1), extract the damaged table's
rows there, and re-insert into production inside one transaction. Export via
`psql \copy` from the restore branch; import with `INSERT ... ON CONFLICT DO
NOTHING` and verify counts before committing.

## 5. Restore acceptance checks (run every drill and every real restore)

Row-count sanity per key table (compare against the last known-good values;
the seed adds 6 courses / 5 categories / 10 analytics learners — a production
restore will be higher, never lower):

```sql
SELECT 'User', count(*) FROM "User"
UNION ALL SELECT 'Course', count(*) FROM "Course"
UNION ALL SELECT 'Enrolment', count(*) FROM "Enrolment"
UNION ALL SELECT 'LessonProgress', count(*) FROM "LessonProgress"
UNION ALL SELECT 'Certificate', count(*) FROM "Certificate"
UNION ALL SELECT 'Order', count(*) FROM "Order"
UNION ALL SELECT 'OutboxEvent', count(*) FROM "OutboxEvent";
```

Behaviour checks: sign in as the owner → owner dashboard renders real metrics;
open one course page; open the student dashboard with a learner account.
Every check must pass before declaring the restore complete.

## 6. Restore drill log

| Date | Environment | Branch / timestamp | Checks (§5) | Operator | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-08-30 | sandbox (embedded PG 18 @ :5433) | `dtg` — full `migrate deploy` + seed + smoke via curl | PASS (health/live, health/ready, /api/v1/courses 200) | Daniel130me | EXAMPLE row — local-Postgres drill proving procedure steps 5–6; Neon-console restore itself is operator-executed |
| | | | | | |

The drill above is an EXAMPLE of the expected record. The Neon-console restore
(branch creation + config flip) must be exercised by the operator who holds
the Neon project access; record it here when done — the exit gate "restore has
been executed, not merely documented" refers to that line.

## 7. Known degraded modes after restore

- **Outbox replay**: events committed but not dispatched before the failure
  point are restored and will dispatch normally (at-least-once; duplicates are
  prevented by the `eventKey` UNIQUE + `skipDuplicates` notification insert).
- **Verification emails**: tokens live in the `Verification` table (hashed,
  1h expiry) — restored tokens that expired during the outage are simply
  re-issued on request; no manual action needed.
- **Webhook verification**: Flutterwave payments verified via the API
  (verify-then-fulfil) reconcile from the provider on retry — a restore that
  loses a paid enrolment is repaired by the reconciliation job, not by hand.
