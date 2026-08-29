# DTG Backend Implementation Plan

## 1. Purpose and release posture

This document defines the production backend implementation plan for the DTG learning platform. It treats the product as a near-release, multi-user system with one platform owner and many students. The owner is the only instructor and administrator. The system will be reviewed for correctness, security, performance, operability, and maintainability.

The implementation will use:

- Neon PostgreSQL as the system of record.
- Prisma as the database client and migration tool.
- Cloudflare R2 for initial object storage.
- A modular monolith inside the existing Next.js application.
- Versioned REST endpoints under `/api/v1`.
- Direct-to-R2 uploads using short-lived presigned URLs.
- An outbox-backed background-job boundary for email, certificate generation, media processing, and other asynchronous work.

The single-owner rule is a current product invariant, not a hard-coded email or frontend assumption. Owner access must be provisioned through a controlled bootstrap process, stored in the database, enforced server-side, and transferable through an audited transaction. The implementation must not introduce multi-instructor tables, instructor applications, revenue splits, or per-instructor tenancy until the product requirement changes.

The launch architecture deliberately avoids microservices. The modules must have strict boundaries so that a high-load module can be extracted later without rewriting its domain rules.

## 2. Current-state assessment

The current repository is a UI prototype, not a deployable backend:

- The application uses mock data for users, courses, enrolments, progress, reviews, certificates, notifications, and analytics.
- Authentication is client-side state only.
- The Prisma datasource is SQLite and contains only sample `User` and `Post` models.
- The only route handler returns `Hello, world!`.
- Course authoring, uploads, notes, Q&A, profile updates, password changes, enrolment, progress, and owner actions are visual-only.
- TypeScript build errors are ignored in `next.config.ts`.
- React strict mode is disabled, `allowJs` is enabled, `skipLibCheck` is enabled, and `noImplicitAny` is disabled.
- There is no API contract, migration history, authorization layer, audit trail, background processing, observability, or automated backend test suite.

These are Phase 0 and Phase 1 blockers. Feature work must not begin by placing database calls directly in UI components or route handlers.

## 3. Non-negotiable engineering standards

Every backend change must satisfy all of the following:

1. **Validate at boundaries.** Parse environment variables and all request input with schemas. Never trust client-supplied IDs, prices, roles, ownership, completion percentages, or object keys.
2. **Authorize in the service layer.** Route guards improve ergonomics but are not the security boundary. Every protected use case must enforce role, ownership, and resource state in the application service.
3. **Use transactions for invariants.** Enrolment, payment fulfilment, progress completion, grading, certificate issuance, publishing, and destructive actions must be atomic.
4. **Make retries safe.** Webhooks, background jobs, enrolment, certificate issuance, uploads, and other repeatable mutations require idempotency keys or unique constraints.
5. **Keep data private by default.** R2 buckets are private. Database queries select only required fields. Logs never contain passwords, tokens, full request bodies, or sensitive personal data.
6. **Design queries before shipping endpoints.** Every list endpoint uses cursor pagination and bounded page sizes. Foreign keys and common filter/sort paths receive explicit indexes. Avoid N+1 queries.
7. **No silent failures.** Use typed errors, structured logs, correlation IDs, metrics, and alerts. Background jobs must have retries, backoff, dead-letter handling, and visible status.
8. **Migrations are append-only after merge.** Production schema changes use reviewed migrations, expand-and-contract patterns, and tested rollback or forward-fix procedures.
9. **Generated aggregates are not sources of truth.** Course ratings, progress percentages, counts, and revenue summaries may be cached, but must be reproducible from canonical records.
10. **A phase is complete only when its tests, documentation, security review, and operational checks pass.** UI success alone is not acceptance.

## 4. Target architecture

```text
Browser / mobile client
        |
        v
Next.js route handlers (/api/v1)
  - authentication/session guard
  - request schema validation
  - rate limiting
  - response/error mapping
        |
        v
Application services (use cases)
  - authorization and ownership
  - transactions and idempotency
  - domain policy and orchestration
        |
        +-------------------+-------------------+
        v                   v                   v
Repositories            Provider ports      Outbox events
  - Prisma                 - Object storage    - email
  - bounded selects        - Email             - certificates
  - cursor queries         - Payments          - media jobs
        |                  - Queue             - analytics
        v
Neon PostgreSQL          R2 / provider adapters / workers
```

Recommended source layout:

```text
src/
  app/
    (public)/                 # public pages and layouts
    (auth)/                   # login, registration, recovery
    (student)/                # authenticated learner routes
    (owner)/                  # owner-only course and operations routes
    api/v1/                   # HTTP adapters only
  features/                   # frontend domain features
    auth/
    catalog/
    courses/
    learning/
    assessments/
    profile/
    owner/
  components/
    ui/                       # reusable visual primitives only
    layout/                   # shared application shells
  server/
    auth/                     # session helpers and policies
    db/                       # Prisma client, transaction helpers
    http/                     # errors, responses, pagination, idempotency
    modules/
      users/
      catalog/
      courses/
      media/
      enrolments/
      learning/
      assessments/
      discussions/
      reviews/
      certificates/
      notifications/
      payments/
      analytics/
      support/
    providers/                # R2, email, payment, queue implementations
    observability/            # logging, tracing, metrics, audit
  contracts/                  # shared request/response schemas and DTOs
  lib/
    client/                   # browser-only helpers and API client
    shared/                   # environment-neutral utilities
prisma/
  schema.prisma
  migrations/
  seed.ts
tests/
  unit/
  integration/
  contract/
  e2e/
  performance/
```

Rules for dependency direction:

- Route handlers may call application services; they may not call Prisma or R2 directly.
- Application services may call repository and provider interfaces.
- Repositories may depend on Prisma, but must not contain HTTP concerns.
- Domain modules may not import UI components.
- Cross-module writes happen through an application service or an outbox event, not by reaching into another module's tables from a route.
- Public API responses use DTOs; Prisma records must never be serialized directly.
- Frontend feature folders may import shared UI and contracts, but must not import Prisma, repositories, or server-only providers.
- Pages compose features and layouts; they must not become large files containing data access, domain rules, and presentation logic together.
- Server state belongs in server components or the selected query layer. URL-visible filters belong in search parameters, not a global navigation context.

Feature/module file convention:

```text
features/<feature>/
  api/                       # typed client calls and query keys
  components/                # feature-specific presentation
  hooks/                     # client orchestration only where required
  schemas/                   # form/client validation schemas
  types/                     # frontend-only view types when needed
  index.ts                   # intentional public exports

server/modules/<module>/
  <module>.service.ts        # use cases and transaction boundaries
  <module>.repository.ts     # persistence queries
  <module>.policy.ts         # authorization/domain policies when needed
  <module>.schemas.ts        # server input schemas
  <module>.types.ts          # domain and port types
  <module>.events.ts         # domain/outbox events when needed
  index.ts                   # intentional public exports
```

Do not create empty layers or one-file directories merely to match the template. A module should add a policy, event, provider, or mapper file only when it has real behavior. This keeps the structure conventional without over-engineering it.

## 5. Data-model baseline

The initial model should cover the product already represented by the UI.

### Identity and access

- `User`: identity, email status, account state, timestamps, soft-delete marker.
- `Profile`: display name, country code, bio, avatar asset, locale, timezone.
- `UserRole`: `STUDENT` or `OWNER`. Public registration can create only `STUDENT` users.
- `PlatformSettings`: singleton platform configuration with the current `ownerUserId`, default currency, brand/contact settings, and audited ownership-transfer metadata.
- `Account`, `Session`, `Verification`: authentication-provider, session, and single-use token records.
- `PasswordResetToken`: hashed, single-use, expiring reset tokens.
- `LoginAttempt` or rate-limit state: security monitoring without storing raw passwords.
- `NotificationPreference`: per-channel preferences.

### Course catalog and authoring

- `Category`: stable slug, display name, status, sort order.
- `Course`: platform-owned course with creator audit reference, slug, title, descriptions, level, language, pricing, lifecycle status, publication timestamps, and version.
- `CourseSection`: ordered sections with a unique `(courseId, position)` constraint.
- `Lesson`: ordered lesson metadata, type, preview status, content, duration, lifecycle status.
- `MediaAsset`: provider-neutral storage metadata, object key, checksum, MIME type, bytes, status, owner, purpose.
- `LessonResource`: lesson-to-asset/link association.
- `CourseRequirement` and `CourseOutcome`: ordered normalized content.

### Learning and engagement

- `Enrollment`: unique `(userId, courseId)`, status, source, timestamps, payment/order link.
- `LessonProgress`: unique `(enrollmentId, lessonId)`, state, watched/read position, completion timestamp.
- `LessonNote`: unique or versioned notes per learner and lesson.
- `DiscussionThread` and `DiscussionPost`: lesson Q&A with moderation state.
- `Review`: unique `(userId, courseId)`, rating, moderation state, owner reply.
- `Notification`: persisted in-app notification with read timestamp.

### Assessments and credentials

- `Quiz`, `QuizQuestion`, `QuizOption`: versioned assessment definition.
- `QuizAttempt` and `QuizAnswer`: immutable submitted attempts and calculated scores.
- `Assignment`, `AssignmentSubmission`, `Grade`: submissions, R2 assets, feedback, grading history.
- `Certificate`: unique enrollment/course credential, public verification code, revocation state, generated asset.

### Commerce and operations

- `Order`, `OrderItem`, `Payment`, `Refund`: money stored in integer minor units with currency.
- `WebhookEvent`: unique provider event ID, signature verification result, processing state.
- `IdempotencyKey`: caller, route, request hash, response reference, expiry.
- `OutboxEvent`: transactional event queue with retry and processing state.
- `ContactSubmission`: support form data, status, assignment, spam metadata.
- `AuditLog`: actor, action, target, safe metadata, IP hash where justified, timestamp.

All externally visible IDs should be non-sequential. Use database-native UUIDs unless a reviewed product requirement calls for another format. Human-readable certificate numbers must be separate from primary keys.

## 6. API conventions

- Prefix all production endpoints with `/api/v1`.
- Use JSON for metadata and presigned URLs for binary transfers.
- Use a single error envelope: `code`, `message`, `requestId`, and optional field-level `details`.
- Never expose stack traces, Prisma errors, provider errors, or existence-sensitive authentication details.
- Use cursor pagination with a stable tie-breaker such as `(createdAt, id)`.
- Apply a documented maximum `limit`; never accept unbounded lists.
- Use `409 Conflict` for state/version conflicts, `422` for valid JSON that violates domain rules, and `429` for throttling.
- Support optimistic concurrency for course editing through a version field or `updatedAt` precondition.
- Require an `Idempotency-Key` for checkout and other high-impact retriable mutations.
- Generate and review an OpenAPI document from the same schemas used at runtime.

## 7. Implementation phases and conventional commits

Each checklist item is intended to be a focused, reviewable commit. Do not combine unrelated commits to reduce the apparent amount of work.

### Phase 0 — Release engineering and quality gates

Goal: make failures visible before backend feature work begins.

- [ ] Document supported runtime, package manager, environment names, and local setup.
  Commit: `docs(backend): define runtime and environment setup`
- [ ] Add a typed environment loader that fails fast and distinguishes server-only from public variables.
  Commit: `feat(config): add validated server environment configuration`
- [ ] Stop ignoring TypeScript build errors and restore production-safe Next.js settings.
  Commit: `fix(build): enforce type-safe production builds`
- [ ] Enable the strict TypeScript options the codebase can satisfy immediately; create tracked remediation for staged options.
  Commit: `chore(types): strengthen TypeScript compiler checks`
- [ ] Add formatting, lint, type-check, unit-test, integration-test, and build scripts with deterministic exit codes.
  Commit: `chore(quality): add backend verification commands`
- [ ] Add CI with dependency caching and required checks for lint, types, tests, migrations, and production build.
  Commit: `ci(backend): add required backend quality gates`
- [ ] Add dependency and secret scanning, lockfile enforcement, and automated update policy.
  Commit: `ci(security): add dependency and secret scanning`
- [ ] Add `.env.example` containing names and safe descriptions only; verify real secrets remain ignored.
  Commit: `docs(config): add safe environment variable template`

Exit gate:

- A clean clone can install, validate configuration, lint, type-check, test, and build in CI.
- Type errors cannot be suppressed at the framework configuration level.
- No credentials or production endpoints are committed.

### Phase 0B — Frontend shell and file-structure correction

Goal: replace prototype-only application structure with conventional routes and feature boundaries without performing an unsafe big-bang rewrite.

- [ ] Introduce public, authentication, student, and owner route groups with shared layouts and stable URLs.
  Commit: `refactor(frontend): introduce route-based application structure`
- [ ] Replace the custom in-memory navigation context with Next.js links, redirects, route parameters, and URL search parameters.
  Commit: `refactor(navigation): migrate prototype views to application routes`
- [ ] Move domain-specific frontend code into `src/features` and keep `src/components/ui` limited to reusable primitives.
  Commit: `refactor(frontend): organize components by product feature`
- [ ] Add route-level loading, error, not-found, and access-denied states.
  Commit: `feat(frontend): add route boundary states`
- [ ] Establish typed API-client and server-query boundaries using shared contracts, request cancellation, and normalized errors.
  Commit: `feat(frontend): add typed data access boundaries`
- [ ] Standardize forms on schema-backed validation, accessible field errors, pending states, duplicate-submit prevention, and success/failure feedback.
  Commit: `refactor(forms): standardize validated form workflows`
- [ ] Define server-component versus client-component rules and remove unnecessary client boundaries as screens are migrated.
  Commit: `perf(frontend): reduce unnecessary client rendering`
- [ ] Add accessibility and responsive-layout checks for public, student, and owner shells.
  Commit: `test(frontend): add shell accessibility and responsive checks`

Migration rule:

- Create the target routes and feature boundaries first.
- Connect each feature to real backend contracts in its corresponding backend phase.
- Keep mock adapters temporary and explicit; do not mix mock and production records in the same repository or hook.
- Remove the prototype navigation and mock-data modules only after parity tests confirm every release screen has migrated.

Exit gate:

- Every release screen has a stable, refresh-safe URL.
- Back/forward navigation, deep links, route protection, loading, and error recovery work without in-memory prototype state.
- No browser bundle can import database or provider code.

### Phase 1 — Neon PostgreSQL and persistence foundation

Goal: create a safe, observable database layer before domain tables.

- [ ] Switch Prisma from SQLite to PostgreSQL and configure separate pooled runtime and direct migration URLs for Neon.
  Commit: `feat(db): configure Prisma for Neon PostgreSQL`
- [ ] Add a singleton Prisma client with environment-aware logging, safe error mapping, and no query logging in production by default.
  Commit: `refactor(db): harden Prisma client lifecycle`
- [ ] Add transaction helpers with explicit timeouts and isolation choice for critical workflows.
  Commit: `feat(db): add transactional execution helpers`
- [ ] Add identity, profile, `STUDENT`/`OWNER` role, platform-settings, session, audit, idempotency, and outbox foundation models.
  Commit: `feat(db): add identity and operational schema`
- [ ] Add a guarded owner-bootstrap command and transactional ownership-transfer service; neither may depend on a hard-coded email.
  Commit: `feat(owner): add controlled owner provisioning`
- [ ] Generate and review the initial PostgreSQL migration; do not use `db push` in shared or production environments.
  Commit: `chore(db): add initial PostgreSQL migration`
- [ ] Add deterministic development seed data and an explicitly guarded seed command.
  Commit: `chore(db): add deterministic development seed`
- [ ] Add database health/readiness checks that use a bounded query and do not reveal connection details.
  Commit: `feat(health): add database readiness endpoint`
- [ ] Add integration-test database provisioning and migration reset isolated from developer and production data.
  Commit: `test(db): add isolated PostgreSQL integration harness`

Exit gate:

- Migrations run from zero and from the previous schema in CI.
- Runtime traffic uses the Neon pooled connection; migrations use the direct connection.
- Health checks have strict timeouts and do not overload the database.

### Phase 2 — HTTP foundation and security controls

Goal: make every endpoint consistent, bounded, traceable, and defensible.

- [ ] Add request IDs, structured logging, safe redaction, and a standard API response/error envelope.
  Commit: `feat(http): add request context and structured errors`
- [ ] Add schema-driven body, query, path, and response validation.
  Commit: `feat(http): add runtime request and response validation`
- [ ] Add reusable cursor pagination and bounded filter/sort parsing.
  Commit: `feat(http): add cursor pagination primitives`
- [ ] Add trusted-proxy handling, security headers, explicit CORS policy, and body-size limits.
  Commit: `feat(security): harden HTTP request handling`
- [ ] Add distributed rate-limit interfaces and policies for public, authenticated, authentication, upload, and webhook routes.
  Commit: `feat(security): add endpoint rate limiting`
- [ ] Add idempotency middleware backed by the database for critical mutations.
  Commit: `feat(http): add idempotent mutation support`
- [ ] Generate the initial OpenAPI contract and add contract-drift validation to CI.
  Commit: `docs(api): publish versioned OpenAPI contract`

Exit gate:

- Invalid and oversized requests fail before domain execution.
- Every response includes a request ID.
- Rate limits work across multiple application instances, not only in process memory.

### Phase 3 — Authentication, sessions, and authorization

Goal: replace prototype login state with secure server-enforced identity.

- [x] Integrate a maintained authentication library with database-backed sessions and Prisma persistence.
  Commit: `feat(auth): add database-backed authentication`
- [x] Implement registration with normalized email, Argon2id password hashing, password policy, and duplicate-safe responses.
  Commit: `feat(auth): implement secure user registration`
- [x] Implement email verification with hashed, expiring, single-use tokens.
  Commit: `feat(auth): add email verification workflow`
- [x] Implement login, logout, session rotation, secure cookies, and generic credential errors.
  Commit: `feat(auth): implement secure session lifecycle`
- [x] Implement forgot/reset-password flows with hashed single-use tokens and session revocation.
  Commit: `feat(auth): add password recovery workflow`
- [x] Add brute-force protection, progressive cooldown, and security-event audit records.
  Commit: `feat(security): protect authentication endpoints`
- [x] Add authorization policy helpers for student-owned resources and owner-only platform operations.
  Commit: `feat(authz): add student and owner access policies`
- [x] Add authenticated `/me`, session listing, and revoke-other-sessions endpoints.
  Commit: `feat(account): add session management endpoints`
- [x] Connect login, registration, verification, recovery, and logout routes to the real session contracts with safe redirect handling.
  Commit: `feat(frontend-auth): connect authentication workflows`
- [x] Add unit, integration, and abuse-case tests for authentication and authorization boundaries.
  Commit: `test(auth): cover authentication and authorization boundaries`

Exit gate:

- No role or user ID is accepted from the client as authority.
- Public registration cannot create or promote an owner account.
- Exactly one active platform owner is referenced by platform settings, and ownership transfer is atomic and audited.
- Session cookies are `HttpOnly`, `Secure` in production, and have an explicit `SameSite` policy.
- Password-reset and email-verification tokens cannot be replayed.

### Phase 4 — Profiles, preferences, and account lifecycle

Goal: support the profile/security UI without exposing or corrupting account data.

- [ ] Implement profile read/update endpoints with field allowlists and locale/country validation.
  Commit: `feat(profile): add profile management endpoints`
- [ ] Implement notification and language preference endpoints.
  Commit: `feat(profile): add user preference management`
- [ ] Implement authenticated password change with current-password verification and session revocation policy.
  Commit: `feat(account): add authenticated password change`
- [ ] Implement avatar association through the media module rather than accepting arbitrary URLs.
  Commit: `feat(profile): add managed avatar support`
- [ ] Implement account deletion as a verified, audited, asynchronous workflow with documented retention rules.
  Commit: `feat(account): add secure account deletion workflow`
- [ ] Connect profile, preferences, password, avatar, session, and deletion screens to the real account contracts.
  Commit: `feat(frontend-profile): connect account management workflows`
- [ ] Test cross-user access, mass-assignment attempts, deletion retries, and partial-failure recovery.
  Commit: `test(account): cover profile and account lifecycle`

Exit gate:

- Users cannot edit immutable identity, role, verification, or ownership fields.
- Deletion has a documented policy for financial, audit, assessment, and certificate records.

### Phase 5 — R2 media and file security

Goal: support scalable uploads without proxying large files through the application server.

- [ ] Define an object-storage port and implement the Cloudflare R2 adapter so a future provider swap is isolated.
  Commit: `feat(storage): add provider-neutral object storage interface`
- [ ] Add `MediaAsset` persistence with owner, purpose, object key, checksum, MIME, bytes, lifecycle status, and timestamps.
  Commit: `feat(media): add managed asset persistence`
- [ ] Implement upload-intent endpoints that authorize purpose, generate random server-owned keys, and return short-lived presigned URLs.
  Commit: `feat(media): add secure direct upload intents`
- [ ] Implement upload completion that verifies object metadata/checksum before making an asset usable.
  Commit: `feat(media): verify completed R2 uploads`
- [ ] Add private signed-download endpoints with enrolment/ownership checks and `Content-Disposition` control.
  Commit: `feat(media): add authorized asset downloads`
- [ ] Add quarantine and malware-scanning workflow before user-supplied files become downloadable.
  Commit: `feat(media): add upload quarantine workflow`
- [ ] Add cleanup for expired intents, abandoned multipart uploads, replaced assets, and delayed deletes.
  Commit: `feat(media): add orphaned object cleanup jobs`
- [ ] Add image derivative processing and metadata stripping for thumbnails and avatars.
  Commit: `feat(media): add safe image processing pipeline`
- [ ] Add range-request and cache-control policy for downloadable media; document that production adaptive video streaming requires a transcoding/streaming service rather than raw R2 objects alone.
  Commit: `perf(media): optimize private media delivery`
- [ ] Add reusable upload UI with progress, cancellation, retry, checksum, server-confirmed completion, and accessible failure states.
  Commit: `feat(frontend-media): add resilient direct upload workflow`
- [ ] Add tests for forged keys, MIME spoofing, oversized files, expired signatures, cross-tenant access, and cleanup retries.
  Commit: `test(media): cover R2 upload and access controls`

Exit gate:

- The client never chooses a trusted object key or makes an object public.
- Unverified or quarantined objects cannot be attached to published content.
- Storage-provider types do not leak outside the adapter.

### Phase 6 — Course catalog and authoring

Goal: replace the mock catalog and owner course-management screens with a complete platform-owned course lifecycle.

- [ ] Add category, course, section, lesson, requirement, outcome, and resource models with lifecycle enums and constraints.
  Commit: `feat(courses): add course authoring schema`
- [ ] Add repositories with bounded projections and indexes for status, category, slug, publication date, and ordered curriculum queries.
  Commit: `perf(courses): add indexed course repositories`
- [ ] Implement public category and published-course list/detail endpoints with cursor pagination.
  Commit: `feat(catalog): add public course catalog endpoints`
- [ ] Implement PostgreSQL full-text/trigram search and validated category, level, price, and sort filters.
  Commit: `feat(catalog): add indexed course search and filters`
- [ ] Implement owner-only draft creation and metadata editing with optimistic concurrency.
  Commit: `feat(courses): add draft course management`
- [ ] Implement transactional section/lesson CRUD and reorder operations with uniqueness protection.
  Commit: `feat(courses): add curriculum authoring endpoints`
- [ ] Implement asset/resource attachment through verified `MediaAsset` references.
  Commit: `feat(courses): add course media and resource attachments`
- [ ] Implement owner-only publish validation that checks required metadata, curriculum, asset readiness, and pricing invariants.
  Commit: `feat(courses): add guarded publication workflow`
- [ ] Implement archive/unpublish behavior that preserves existing learner access according to product policy.
  Commit: `feat(courses): add course archival lifecycle`
- [ ] Add cache tags for public catalog reads and invalidate them only after committed authoring changes.
  Commit: `perf(catalog): add safe catalog caching`
- [ ] Connect public catalog/search/detail routes to real DTOs using URL-based filters and server-rendered public metadata.
  Commit: `feat(frontend-catalog): connect course discovery workflows`
- [ ] Replace the owner course prototype with validated draft, curriculum, upload, reorder, preview, and publish workflows.
  Commit: `feat(frontend-owner): connect course authoring workflows`
- [ ] Add domain, authorization, concurrency, search, and query-count tests.
  Commit: `test(courses): cover catalog and authoring workflows`

Exit gate:

- Draft content and private assets never appear in public results.
- Reordering cannot produce duplicate positions or lost lessons.
- Catalog endpoints have fixed query budgets and stable pagination under concurrent inserts.

### Phase 7 — Orders, payments, and enrolment

Goal: make free and paid enrolment atomic, idempotent, and auditable.

- [x] Add provider-neutral payment interfaces and choose/configure the launch provider before enabling paid courses.
  Commit: `feat(payments): add payment provider boundary`
- [x] Add order, order-item, payment, refund, webhook-event, and enrolment models with monetary constraints and unique provider references.
  Commit: `feat(payments): add commerce and enrolment schema`
- [x] Implement idempotent free-course enrolment with unique `(userId, courseId)` enforcement.
  Commit: `feat(enrolments): add free course enrolment`
- [x] Implement checkout initialization using server-owned course price and currency snapshots.
  Commit: `feat(payments): add secure checkout initialization`
- [x] Implement signature-verified, replay-safe payment webhooks that fulfil orders and enrolments transactionally.
  Commit: `feat(payments): add idempotent webhook fulfilment`
- [x] Implement order/payment status endpoints and recovery for provider success followed by local processing failure.
  Commit: `feat(payments): add payment reconciliation workflow`
- [x] Implement refund and enrolment-access policy with immutable financial audit records.
  Commit: `feat(payments): add refund and access revocation workflow`
- [x] Connect enrol/checkout/status UI with duplicate-submit protection, recoverable pending states, and server-owned pricing.
  Commit: `feat(frontend-payments): connect enrolment and checkout workflows`
- [x] Add tests for price tampering, duplicate webhooks, reordered events, abandoned checkout, partial failure, and currency rounding.
  Commit: `test(payments): cover payment and enrolment invariants`

Exit gate:

- Client-supplied prices are ignored.
- A payment event can be delivered repeatedly without creating duplicate orders or enrolments.
- Money uses integer minor units and an explicit currency everywhere.

### Phase 8 — Learning progress, notes, and discussions

Goal: provide durable learner state and secure course access.

- [x] Add lesson-progress, lesson-note, discussion-thread, and discussion-post models with ownership and ordering constraints.
  Commit: `feat(learning): add progress notes and discussion schema`
- [x] Implement learner dashboard and “my learning” read models with bounded, indexed queries.
  Commit: `feat(learning): add learner dashboard endpoints`
- [x] Implement curriculum access rules for enrolments and explicitly marked public previews.
  Commit: `feat(learning): enforce lesson access policies`
- [x] Implement idempotent progress updates with monotonic completion rules and server-derived course progress.
  Commit: `feat(learning): add durable lesson progress tracking`
- [x] Implement note save/export endpoints with per-user authorization and sensible size limits.
  Commit: `feat(learning): add private lesson notes`
- [x] Implement lesson Q&A creation, replies, pagination, moderation state, and notifications.
  Commit: `feat(discussions): add lesson question and answer workflows`
- [x] Add transactional completion events for analytics and certificate eligibility.
  Commit: `feat(learning): emit course completion events`
- [x] Connect learner dashboard, course library, player, progress, notes, resources, and Q&A to the real learning contracts.
  Commit: `feat(frontend-learning): connect learner workflows`
- [x] Add concurrency, access-control, query-count, and progress-invariant tests.
  Commit: `test(learning): cover progress and course access`

Exit gate:

- Progress cannot move another learner, reference a lesson outside the enrolment's course, or exceed valid bounds.
- Course completion is derived from required lesson state, not trusted from a client percentage.

### Phase 9 — Quizzes, assignments, grading, and certificates

Goal: complete the assessment-to-credential path without trust gaps.

- [ ] Add versioned quiz/question/option, attempt/answer, assignment/submission, grade, and certificate models.
  Commit: `feat(assessments): add assessment and certificate schema`
- [ ] Implement owner-only assessment authoring with answer keys excluded from learner DTOs.
  Commit: `feat(assessments): add secure assessment authoring`
- [ ] Implement attempt start/submit with attempt limits, expiry, immutable question-version snapshots, and server-side scoring.
  Commit: `feat(quizzes): add secure quiz attempt workflow`
- [ ] Implement assignment submission through verified R2 assets with deadlines and resubmission policy.
  Commit: `feat(assignments): add managed assignment submissions`
- [ ] Implement owner grading with history, feedback, and learner notification.
  Commit: `feat(grading): add audited grading workflow`
- [ ] Implement certificate eligibility from canonical completion/assessment state and issue exactly once.
  Commit: `feat(certificates): add idempotent certificate issuance`
- [ ] Generate certificate files asynchronously, store them privately in R2, and expose signed downloads.
  Commit: `feat(certificates): add certificate generation pipeline`
- [ ] Add public verification by high-entropy code with minimal personal information and revocation support.
  Commit: `feat(certificates): add public certificate verification`
- [ ] Connect quiz, assignment, grading, certificate list/download, and public verification screens to real contracts.
  Commit: `feat(frontend-assessments): connect assessment and certificate workflows`
- [ ] Add answer-leakage, replay, race-condition, grading authorization, and duplicate-certificate tests.
  Commit: `test(assessments): cover assessment and credential security`

Exit gate:

- Correct answers are never present in learner-facing payloads before permitted review.
- Certificate issuance remains unique under concurrent completion events.

### Phase 10 — Reviews, notifications, support, and email

Goal: implement the remaining engagement and operational workflows.

- [ ] Implement verified-enrolment review creation/update, owner moderation, rating aggregation, and owner replies.
  Commit: `feat(reviews): add verified course reviews`
- [ ] Add transactional aggregate maintenance or safe async recomputation for course rating/count.
  Commit: `perf(reviews): add consistent rating aggregates`
- [ ] Implement persisted in-app notifications with cursor pagination, mark-read, and mark-all-read.
  Commit: `feat(notifications): add in-app notification endpoints`
- [ ] Add an email-provider port, templated transactional emails, suppression handling, and safe retry behavior.
  Commit: `feat(email): add transactional email delivery`
- [ ] Connect outbox events to verification, recovery, enrolment, grading, discussion, and certificate messages.
  Commit: `feat(notifications): connect domain notification workflows`
- [ ] Implement contact submission with validation, aggressive rate limiting, spam controls, retention, and support notification.
  Commit: `feat(support): add protected contact workflow`
- [ ] Connect review, notification, and contact interfaces with optimistic UI only where server reconciliation is defined.
  Commit: `feat(frontend-engagement): connect engagement workflows`
- [ ] Add review-abuse, notification ownership, email retry, and contact-spam tests.
  Commit: `test(engagement): cover reviews notifications and support`

Exit gate:

- Failed email delivery cannot roll back a successful user transaction.
- Users cannot read, modify, or infer another user's notifications.

### Phase 11 — Owner analytics and administration

Goal: replace fabricated dashboards with accurate, performant operational data.

- [ ] Define analytics metrics precisely, including time zone, date range, enrolment, completion, rating, and revenue semantics.
  Commit: `docs(analytics): define dashboard metric contracts`
- [ ] Implement owner dashboard read models for platform courses, learners, completion, ratings, and revenue.
  Commit: `feat(analytics): add owner dashboard queries`
- [ ] Implement owner-only student-management search and pagination with field-minimized responses.
  Commit: `feat(owner): add student management endpoints`
- [ ] Add aggregate tables/materialized views only where measured query plans justify them.
  Commit: `perf(analytics): add measured dashboard aggregates`
- [ ] Add background refresh/incremental aggregation and freshness indicators.
  Commit: `feat(analytics): add resilient aggregate refresh jobs`
- [ ] Implement owner-only operational endpoints for users, courses, support, audit lookup, and certificate revocation.
  Commit: `feat(owner): add secured operational endpoints`
- [ ] Add export jobs with authorization, row limits, private R2 delivery, expiry, and audit records.
  Commit: `feat(exports): add secure asynchronous data exports`
- [ ] Connect owner dashboard, learner management, operational actions, and export status to the real owner contracts.
  Commit: `feat(frontend-owner): connect analytics and operations workflows`
- [ ] Add metric-correctness fixtures, ownership tests, query-plan checks, and large-dataset performance tests.
  Commit: `test(analytics): verify metrics access and performance`

Exit gate:

- Every metric has a documented formula and deterministic fixture.
- Dashboard queries stay within the agreed query-count and latency budgets at launch-scale data volume.

### Phase 12 — Observability, resilience, privacy, and release

Goal: prove the backend can be operated safely in production.

- [ ] Add application error monitoring with source maps, release identifiers, environment separation, and PII redaction.
  Commit: `feat(observability): add production error monitoring`
- [ ] Add OpenTelemetry traces across HTTP, database, R2, payment, email, and job boundaries.
  Commit: `feat(observability): add distributed tracing`
- [ ] Add service-level metrics and alerts for error rate, latency, auth abuse, DB saturation, webhook lag, outbox lag, job failures, and R2 failures.
  Commit: `feat(observability): add backend metrics and alerts`
- [ ] Add liveness, readiness, and dependency diagnostics with access controls appropriate to each endpoint.
  Commit: `feat(health): add production health diagnostics`
- [ ] Add graceful shutdown, bounded provider timeouts, retry policies with jitter, and circuit-breaking where measured failure modes justify it.
  Commit: `feat(resilience): harden external dependency handling`
- [ ] Define Neon backup/PITR settings, R2 lifecycle/versioning policy, recovery objectives, and a tested restore runbook.
  Commit: `docs(recovery): add backup and restore runbook`
- [ ] Implement retention, user data export, deletion/anonymization, and privacy audit procedures.
  Commit: `feat(privacy): add data lifecycle workflows`
- [ ] Add migration deployment checks, expand-and-contract guidance, and rollback/forward-fix runbooks.
  Commit: `docs(db): add production migration runbook`
- [ ] Add load tests for catalog, login, dashboard, progress writes, presigning, checkout, and webhooks using production-like data.
  Commit: `test(performance): add backend load test suite`
- [ ] Add security tests for OWASP API risks, broken object-level authorization, mass assignment, CSRF, SSRF, injection, upload abuse, and secret leakage.
  Commit: `test(security): add backend abuse test suite`
- [ ] Run a dependency/license audit and resolve launch-blocking findings.
  Commit: `chore(security): resolve release dependency findings`
- [ ] Add a production smoke test and post-deployment verification script.
  Commit: `test(release): add production smoke checks`
- [ ] Remove prototype authentication/mock data paths only after all screens use real contracts.
  Commit: `refactor(prototype): remove mock backend dependencies`
- [ ] Publish the final API, operations, incident-response, and reviewer documentation.
  Commit: `docs(release): publish backend operations handbook`

Exit gate:

- Restore procedure has been executed successfully, not merely documented.
- Load and security tests meet agreed launch thresholds.
- Alerts reach an owned channel and include actionable runbooks.
- The production smoke test passes after a migration and deployment.

## 8. Required database indexes and query policy

Exact indexes must be confirmed with real query plans, but the initial reviewed set should include:

- Unique normalized user email.
- Session token hash and session expiry.
- Course slug; `(status, publishedAt, id)`; `(status, updatedAt, id)`; category/level publication filters.
- PostgreSQL full-text or trigram indexes for published course search.
- Unique enrolment `(userId, courseId)` plus `(courseId, status, createdAt, id)`.
- Unique progress `(enrollmentId, lessonId)` plus completion lookup indexes.
- Unique section/lesson positions within their parents.
- Review `(courseId, moderationStatus, createdAt, id)` and unique reviewer/course.
- Notification `(userId, readAt, createdAt, id)`.
- Payment provider reference, webhook provider event ID, order owner/status.
- Outbox `(status, availableAt, id)` with a partial index for pending work.
- Media asset `(ownerId, status, createdAt)` and unique provider/object key.
- Certificate verification code and unique eligible enrolment/course issuance key.

Query rules:

- Use Prisma `select` rather than broad `include` on public and list endpoints.
- Set per-endpoint query-count budgets in integration tests for high-traffic paths.
- Inspect `EXPLAIN (ANALYZE, BUFFERS)` against production-like data before launch.
- Avoid offset pagination for growing datasets.
- Cache only public, stable reads initially. Never put personalized or authorization-sensitive responses in a shared cache.
- Prefer a small number of set-based queries over per-record queries.
- Add denormalized counters only after measuring, and update them transactionally or through replayable events.

## 9. Test strategy and definition of done

Every implementation commit must include tests at the lowest useful level.

### Test layers

- **Unit:** domain policies, state transitions, schema parsing, calculations, and provider-independent services.
- **Integration:** real PostgreSQL migrations, repositories, transactions, constraints, race conditions, and route/service integration.
- **Contract:** OpenAPI schemas, error envelopes, pagination, authentication requirements, and frontend DTO compatibility.
- **Provider:** R2 presigning/metadata behavior, payment signature verification, email mapping, and queue retry semantics.
- **End-to-end:** registration through learning and certificate verification; owner authoring through publication; paid enrolment through webhook fulfilment.
- **Performance:** production-like row counts and concurrency, query budgets, p95/p99 latency, connection pressure, and job lag.
- **Security:** BOLA/IDOR, broken role controls, token replay, mass assignment, injection, SSRF, CSRF, brute force, unsafe upload, webhook forgery, and sensitive logging.

### Definition of done for every implementation

- Acceptance criteria and negative cases are documented.
- Request, response, domain, and persistence types are explicit.
- Authorization is tested for allowed role, wrong role, wrong owner, anonymous user, missing resource, and invalid resource state.
- Queries are bounded, indexed where appropriate, and checked for N+1 behavior.
- Mutations define transaction and idempotency behavior.
- Logs, metrics, audit events, and user-safe errors are present where operationally relevant.
- Unit/integration/contract tests pass.
- Migration impact and rollback/forward-fix behavior are reviewed.
- Documentation and OpenAPI contracts are updated.
- `lint`, `typecheck`, tests, migration checks, and production build pass in CI.
- The code is readable, structured, minimally coupled, documented where logic is non-obvious, and contains no magic values or hard-coded deployment assumptions.

## 10. Release gates

The product must not be released until all applicable gates pass:

1. **Functionality:** every visible UI action is connected to a real API or explicitly removed from the release UI.
2. **Authorization:** a resource-access matrix has been reviewed and automated BOLA tests pass.
3. **Data integrity:** migrations, constraints, transactions, idempotency, and concurrency tests pass.
4. **Security:** secrets, dependencies, authentication, uploads, payments, webhooks, and OWASP API checks pass with no unresolved critical/high finding.
5. **Performance:** launch load targets are written down and p95/p99 latency, error rate, query count, and database connection usage meet them.
6. **Resilience:** provider timeouts, retries, dead-letter handling, reconciliation, and graceful degradation are tested.
7. **Recovery:** Neon restore and required R2 recovery/versioning procedures have been exercised.
8. **Observability:** production logs, traces, metrics, alerts, dashboards, and runbooks are verified end to end.
9. **Privacy:** data retention, export, deletion, consent, and log-redaction behavior are documented and tested.
10. **Operations:** deployment, migration, rollback/forward-fix, incident response, and smoke-test runbooks are reviewer-ready.

## 11. Recommended execution order

The critical path is:

```text
Phase 0 quality gates
  -> Phase 1 database
  -> Phase 2 HTTP/security foundation
  -> Phase 3 authentication/authorization
  -> Phase 5 media + Phase 6 courses
  -> Phase 7 payments/enrolment
  -> Phase 8 learning
  -> Phase 9 assessments/certificates
  -> Phase 10 engagement
  -> Phase 11 analytics/admin
  -> Phase 12 release hardening
```

Phase 4 can proceed after Phase 3. Parts of Phase 5 can proceed after Phase 2. Observability, audit logging, tests, and documentation are not work to postpone until Phase 12; each earlier phase must add its own coverage. Phase 12 completes system-wide validation and operational readiness.

For the fastest safe launch, define the release feature set before Phase 6. Any visible paid-course, quiz, assignment, Q&A, certificate, or messaging control either needs its full backend phase and tests or must be hidden from the release interface. Shipping a visual control backed by placeholder behavior is an implementation gap.
