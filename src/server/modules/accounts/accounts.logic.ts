import { createHash } from "node:crypto";
import {
  ACCOUNT_NOT_ACTIVE,
  DELETION_CONFIRMATION_MISMATCH,
  DELETION_CONFIRMATION_WORD,
  EMAIL_UNCHANGED,
  NOTIFICATION_PREFS_DEFAULTS,
  NOTIFICATION_PREF_KEYS,
  OWNER_DELETE_FORBIDDEN,
  type AccountExportDto,
  type NotificationPrefKey,
  type NotificationPrefsDto,
  type UpdateAccountProfileInput,
} from "@/contracts/accounts";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/auth/password";

/**
 * Re-exported under their account-scoped names so callers (and the unit
 * tests) can pin the account password policy to the auth-layer constants
 * without importing both modules.
 */
export const ACCOUNT_PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH;
export const ACCOUNT_PASSWORD_MAX_LENGTH = PASSWORD_MAX_LENGTH;

// Pure decision/build logic for the accounts module (house *.logic.ts pattern).
// Nothing here touches the database or the Prisma client, so the trust rules —
// mass-assignment safety, the password policy, the deletion guards, the
// deterministic anonymization — are unit-testable in isolation while the
// service only translates rejected decisions into client-matchable ApiErrors.

/** Audit action vocabulary for the account endpoints (USER_STATUS_AUDIT style). */
export const ACCOUNT_AUDIT = {
  profileUpdated: "account.profile.updated",
  passwordChanged: "account.password.changed",
  emailChangeRequested: "account.email.change_requested",
  deleted: "account.deleted",
} as const;

/** Retention policy marker written into the deletion audit row. */
export const ACCOUNT_RETENTION_POLICY = "v1";

// ---------------------------------------------------------------------------
// Profile update normalization (mass-assignment safety)
// ---------------------------------------------------------------------------

/**
 * A normalized update carries only fields the caller actually sent; `null`
 * explicitly clears bio/countryCode. Everything else stays untouched.
 */
export interface NormalizedProfileUpdate {
  name?: string;
  bio?: string | null;
  countryCode?: string | null;
  locale?: string;
  notificationPrefs?: Partial<NotificationPrefsDto>;
}

/**
 * Strips `undefined` from an already schema-parsed body so the service can
 * branch on presence, and collapses an empty (whitespace-trimmed) bio to
 * `null` — the client clears the bio by sending an empty string, and the
 * column stores NULL instead of "". Unknown keys never reach this point: the
 * contract schema is a strictObject and rejects them with a 422.
 */
export function normalizeUpdate(input: UpdateAccountProfileInput): NormalizedProfileUpdate {
  const normalized: NormalizedProfileUpdate = {};

  if (input.name !== undefined) normalized.name = input.name;
  if (input.bio !== undefined) normalized.bio = input.bio === "" ? null : input.bio;
  if (input.countryCode !== undefined) normalized.countryCode = input.countryCode;
  if (input.locale !== undefined) normalized.locale = input.locale;
  if (input.notificationPrefs !== undefined) normalized.notificationPrefs = input.notificationPrefs;

  return normalized;
}

/**
 * Merges a notification-prefs patch over the stored JSON. The stored value is
 * untrusted wire data from an earlier version (or a null column), so unknown
 * keys and non-boolean values are dropped before merging; missing keys fall
 * back to the contract defaults. The result is always the complete 4-key
 * document the profile DTO promises.
 */
export function mergeNotificationPrefs(
  stored: unknown,
  patch: Partial<NotificationPrefsDto> | undefined,
): NotificationPrefsDto {
  const merged: Record<string, boolean> = { ...NOTIFICATION_PREFS_DEFAULTS };

  if (stored !== null && typeof stored === "object") {
    for (const key of NOTIFICATION_PREF_KEYS) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === "boolean") merged[key] = value;
    }
  }

  if (patch) {
    for (const key of NOTIFICATION_PREF_KEYS) {
      const value = patch[key as NotificationPrefKey];
      if (typeof value === "boolean") merged[key] = value;
    }
  }

  return merged as NotificationPrefsDto;
}

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

export type PasswordPolicyDecision =
  | { ok: true }
  | { ok: false; code: "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG" | "PASSWORD_UNCHANGED" };

/**
 * Pure policy for a NEW password. Length limits mirror better-auth's own
 * emailAndPassword config (see ACCOUNT_PASSWORD_* in the contract), and the
 * new password must differ from the current one so "change" can never be a
 * no-op that only revokes sessions.
 */
export function evaluatePasswordChange(
  newPassword: string,
  currentPassword: string,
): PasswordPolicyDecision {
  if (newPassword.length < ACCOUNT_PASSWORD_MIN_LENGTH) return { ok: false, code: "PASSWORD_TOO_SHORT" };
  if (newPassword.length > ACCOUNT_PASSWORD_MAX_LENGTH) return { ok: false, code: "PASSWORD_TOO_LONG" };
  if (newPassword === currentPassword) return { ok: false, code: "PASSWORD_UNCHANGED" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Email change policy
// ---------------------------------------------------------------------------

export type EmailChangeDecision =
  | { ok: true; normalizedEmail: string }
  | { ok: false; code: typeof EMAIL_UNCHANGED };

/**
 * Pure policy for a NEW email. The caller's schema already trims/lowercases,
 * but the normalization is repeated here so the rule holds for any future
 * caller; comparison happens on the normalized pair so "same address,
 * different case" can never slip through as a change.
 */
export function evaluateEmailChange(newEmail: string, currentEmail: string): EmailChangeDecision {
  const normalizedEmail = newEmail.trim().toLowerCase();
  if (normalizedEmail === currentEmail.trim().toLowerCase()) {
    return { ok: false, code: EMAIL_UNCHANGED };
  }
  return { ok: true, normalizedEmail };
}

// ---------------------------------------------------------------------------
// Account deletion
// ---------------------------------------------------------------------------

export interface DeletionGuardTarget {
  role: "STUDENT" | "OWNER";
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
}

export type DeletionDecision =
  | { ok: true }
  | { ok: false; code: typeof OWNER_DELETE_FORBIDDEN | typeof ACCOUNT_NOT_ACTIVE };

/**
 * Guards for self-service deletion, in deliberate order:
 * 1. The platform owner account can never be deleted — it owns
 *    PlatformSettings and is the only reachable administrator by design.
 * 2. Only ACTIVE accounts delete themselves. A DELETED caller can never get
 *    here (requireAuthenticatedUser rejects non-ACTIVE sessions), so the
 *    reachable failure is a SUSPENDED account.
 */
export function evaluateAccountDeletion(target: DeletionGuardTarget): DeletionDecision {
  if (target.role === "OWNER") return { ok: false, code: OWNER_DELETE_FORBIDDEN };
  if (target.status !== "ACTIVE") return { ok: false, code: ACCOUNT_NOT_ACTIVE };
  return { ok: true };
}

export function evaluateDeletionConfirmation(
  confirmation: string,
): { ok: true } | { ok: false; code: typeof DELETION_CONFIRMATION_MISMATCH } {
  if (confirmation !== DELETION_CONFIRMATION_WORD) {
    return { ok: false, code: DELETION_CONFIRMATION_MISMATCH };
  }
  return { ok: true };
}

/**
 * Deterministic post-deletion identity: the same userId always anonymizes to
 * the same email, so the User.email/emailNormalized UNIQUE constraints keep
 * holding and a re-registered address never collides with a ghost. The first
 * 8 characters of the uuid (32 bits of hex) make distinct accounts distinct
 * for every practical purpose; a prefix collision would surface as a UNIQUE
 * violation, never as silent identity reuse.
 */
export function anonymizeIdentity(userId: string): { anonymizedName: string; anonymizedEmail: string } {
  return {
    anonymizedName: "Deleted User",
    anonymizedEmail: `deleted-${userId.slice(0, 8).toLowerCase()}@deleted.invalid`,
  };
}

/**
 * better-auth stores verification identifiers hashed
 * (`verification.storeIdentifier: "hashed"` — base64url of the SHA-256 of the
 * identifier, unpadded). Deletion must sweep the ghost email's pending
 * verification/recovery tokens, so it targets the same digest the auth layer
 * writes; the plain email is included in the service's `in` clause as a
 * belt-and-braces fallback for a future storeIdentifier change.
 */
export function hashedEmailIdentifier(email: string): string {
  return createHash("sha256").update(email, "utf8").digest("base64url");
}

// ---------------------------------------------------------------------------
// Account data export builder
// ---------------------------------------------------------------------------

/**
 * Raw-row input shapes for the export builder. These are structural types the
 * service's Prisma select results satisfy directly (Dates in, ISO strings
 * out) — importing generated Prisma types here would couple the pure module
 * to the generated client.
 */
export interface AccountExportRowInput {
  account: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    role: string;
    status: string;
    createdAt: Date;
  };
  profile: {
    displayName: string;
    bio: string | null;
    countryCode: string | null;
    locale: string;
    timezone: string;
    notificationPrefs: NotificationPrefsDto;
  };
  enrolments: Array<{
    courseTitle: string;
    status: string;
    source: string;
    createdAt: Date;
    completedAt: Date | null;
    revokedAt: Date | null;
  }>;
  lessonProgress: Array<{ courseId: string; lessonId: string; completedAt: Date }>;
  notes: Array<{
    courseId: string;
    lessonId: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  threads: Array<{
    courseId: string;
    lessonId: string;
    title: string;
    status: string;
    createdAt: Date;
  }>;
  posts: Array<{ threadId: string; body: string; status: string; createdAt: Date }>;
  quizAttempts: Array<{
    courseId: string;
    attemptNumber: number;
    status: string;
    scorePercent: number | null;
    passed: boolean | null;
    submittedAt: Date | null;
  }>;
  assignmentSubmissions: Array<{
    courseId: string;
    attemptNumber: number;
    status: string;
    submittedAt: Date;
  }>;
  certificates: Array<{
    code: string;
    status: string;
    issuedAt: Date;
    revokedAt: Date | null;
  }>;
  orders: Array<{
    id: string;
    status: string;
    totalMinor: number;
    currency: string;
    createdAt: Date;
    payments: Array<{
      status: string;
      amountMinor: number;
      currency: string;
      createdAt: Date;
    }>;
  }>;
  reviews: Array<{
    courseTitle: string;
    rating: number;
    body: string;
    status: string;
    createdAt: Date;
  }>;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/**
 * Builds the export document from raw rows: Dates become ISO strings, enum
 * labels pass through verbatim (exports are data records, per the Phase 11
 * export house rule). Nothing here fetches, filters, or redacts beyond what
 * the service already selected — quiz question snapshots and provider
 * payloads never reach this point because the service never reads them.
 */
export function buildAccountExportDocument(
  input: AccountExportRowInput,
  generatedAt: Date = new Date(),
): AccountExportDto {
  return {
    generatedAt: generatedAt.toISOString(),
    retentionPolicy: ACCOUNT_RETENTION_POLICY,
    account: {
      id: input.account.id,
      name: input.account.name,
      email: input.account.email,
      emailVerified: input.account.emailVerified,
      role: input.account.role,
      status: input.account.status,
      joinedAt: input.account.createdAt.toISOString(),
    },
    profile: { ...input.profile },
    enrolments: input.enrolments.map((row) => ({
      courseTitle: row.courseTitle,
      status: row.status,
      source: row.source,
      enrolledAt: row.createdAt.toISOString(),
      completedAt: iso(row.completedAt),
      revokedAt: iso(row.revokedAt),
    })),
    lessonProgress: input.lessonProgress.map((row) => ({
      courseId: row.courseId,
      lessonId: row.lessonId,
      completedAt: row.completedAt.toISOString(),
    })),
    notes: input.notes.map((row) => ({
      courseId: row.courseId,
      lessonId: row.lessonId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    discussions: {
      threads: input.threads.map((row) => ({
        courseId: row.courseId,
        lessonId: row.lessonId,
        title: row.title,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
      posts: input.posts.map((row) => ({
        threadId: row.threadId,
        body: row.body,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
    },
    quizAttempts: input.quizAttempts.map((row) => ({
      courseId: row.courseId,
      attemptNumber: row.attemptNumber,
      status: row.status,
      scorePercent: row.scorePercent,
      passed: row.passed,
      submittedAt: iso(row.submittedAt),
    })),
    assignmentSubmissions: input.assignmentSubmissions.map((row) => ({
      courseId: row.courseId,
      attemptNumber: row.attemptNumber,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
    })),
    certificates: input.certificates.map((row) => ({
      code: row.code,
      status: row.status,
      issuedAt: row.issuedAt.toISOString(),
      revokedAt: iso(row.revokedAt),
    })),
    orders: input.orders.map((row) => ({
      id: row.id,
      status: row.status,
      totalMinor: row.totalMinor,
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
      payments: row.payments.map((payment) => ({
        status: payment.status,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        createdAt: payment.createdAt.toISOString(),
      })),
    })),
    reviews: input.reviews.map((row) => ({
      courseTitle: row.courseTitle,
      rating: row.rating,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
