import { z } from "zod";

// ---------------------------------------------------------------------------
// Named constants (no magic values)
// ---------------------------------------------------------------------------

/** Display-size limits — mirror the Profile/User VarChar columns. */
export const NAME_MAX = 120;
export const BIO_MAX = 1000;
export const COUNTRY_CODE_LENGTH = 2;

/** Locales the profile surface supports; the default seeds new profiles. */
export const LOCALES = ["en", "fr", "es"] as const;
export const LOCALE_DEFAULT = "en";
export type LocaleValue = (typeof LOCALES)[number];

/**
 * Roles on the platform. Client-safe tuple mirroring the Prisma UserRole enum
 * (the generated enum type is never imported into client bundles).
 */
export const ACCOUNT_ROLES = ["STUDENT", "OWNER"] as const;
export type AccountRoleValue = (typeof ACCOUNT_ROLES)[number];

/**
 * Password policy for a NEW password. The values are pinned to
 * src/server/auth/password.ts (PASSWORD_MIN_LENGTH / PASSWORD_MAX_LENGTH),
 * which also configures better-auth's emailAndPassword limits — a password
 * accepted here must never be rejected again at sign-in. The unit tests pin
 * the equality so drift fails loudly.
 */
export const ACCOUNT_PASSWORD_MIN_LENGTH = 12;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 128;

/** The exact word the user must type to confirm account deletion. */
export const DELETION_CONFIRMATION_WORD = "DELETE";

/** Client-matchable error codes shared by server and client. */
export const OWNER_DELETE_FORBIDDEN = "OWNER_DELETE_FORBIDDEN";
export const ACCOUNT_NOT_ACTIVE = "ACCOUNT_NOT_ACTIVE";
export const INVALID_CREDENTIALS = "INVALID_CREDENTIALS";
export const DELETION_CONFIRMATION_MISMATCH = "DELETION_CONFIRMATION_MISMATCH";

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

/**
 * The four learner-facing notification toggles. The persisted JSON is a
 * partial record of these keys; any missing key reads as NOTIFICATION_PREFS_DEFAULTS
 * so adding a fifth toggle later needs no migration or backfill.
 */
export const NOTIFICATION_PREF_KEYS = [
  "emailNotifications",
  "courseUpdates",
  "newContent",
  "promotionalEmails",
] as const;

export type NotificationPrefKey = (typeof NOTIFICATION_PREF_KEYS)[number];

export type NotificationPrefsDto = Record<NotificationPrefKey, boolean>;

export const NOTIFICATION_PREFS_DEFAULTS: NotificationPrefsDto = {
  emailNotifications: true,
  courseUpdates: true,
  newContent: false,
  promotionalEmails: false,
};

/** The full (merged) preferences document served on the profile. */
export const notificationPrefsSchema = z.object({
  emailNotifications: z.boolean(),
  courseUpdates: z.boolean(),
  newContent: z.boolean(),
  promotionalEmails: z.boolean(),
});

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

export const accountProfileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  role: z.enum(ACCOUNT_ROLES),
  joinedAt: z.iso.datetime(),
  profile: z.object({
    displayName: z.string(),
    bio: z.string().nullable(),
    countryCode: z.string().nullable(),
    locale: z.enum(LOCALES),
    timezone: z.string(),
    notificationPrefs: notificationPrefsSchema,
  }),
  /** Quick-badge counters computed server-side (never trusted from the client). */
  stats: z.object({
    enrolmentCount: z.number().int().nonnegative(),
    completedCourseCount: z.number().int().nonnegative(),
    certificateCount: z.number().int().nonnegative(),
  }),
});

export type AccountProfileDto = z.infer<typeof accountProfileSchema>;
export type AccountStatsDto = z.infer<typeof accountProfileSchema>["stats"];

// ---------------------------------------------------------------------------
// Input contracts (mass-assignment safe: unknown keys are rejected)
// ---------------------------------------------------------------------------

/**
 * PATCH /account/profile body. All fields optional; a field's presence (after
 * undefined-stripping in normalizeUpdate) decides whether it is written.
 * `null` clears bio/countryCode. Country codes are normalized to uppercase
 * before the 2-letter check, so "ng" is accepted and stored as "NG".
 */
export const updateAccountProfileSchema = z.strictObject({
  name: z.string().trim().min(1, "Name cannot be empty.").max(NAME_MAX).optional(),
  bio: z.string().trim().max(BIO_MAX).nullable().optional(),
  countryCode: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine(
      (value) => /^[A-Z]{2}$/.test(value),
      { message: "Country code must be a 2-letter ISO code." },
    )
    .nullable()
    .optional(),
  locale: z.enum(LOCALES).optional(),
  notificationPrefs: z
    .strictObject({
      emailNotifications: z.boolean().optional(),
      courseUpdates: z.boolean().optional(),
      newContent: z.boolean().optional(),
      promotionalEmails: z.boolean().optional(),
    })
    .optional(),
});

export type UpdateAccountProfileInput = z.infer<typeof updateAccountProfileSchema>;

export const changePasswordSchema = z.strictObject({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z
    .string()
    .min(ACCOUNT_PASSWORD_MIN_LENGTH)
    .max(ACCOUNT_PASSWORD_MAX_LENGTH),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const deleteAccountSchema = z.strictObject({
  confirmation: z.string(),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

// ---------------------------------------------------------------------------
// Account data export (GET /account/download)
// ---------------------------------------------------------------------------

/**
 * The JSON document streamed by the export endpoint. Row shapes are data
 * records: raw enum labels, ISO timestamps. Confidential provider payloads
 * and quiz answer keys are deliberately excluded (quiz snapshot is
 * server-side only; payments carry no secrets beyond status/amount).
 */
export const accountExportSchema = z.object({
  generatedAt: z.iso.datetime(),
  retentionPolicy: z.string(),
  account: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    role: z.string(),
    status: z.string(),
    joinedAt: z.iso.datetime(),
  }),
  profile: z.object({
    displayName: z.string(),
    bio: z.string().nullable(),
    countryCode: z.string().nullable(),
    locale: z.string(),
    timezone: z.string(),
    notificationPrefs: notificationPrefsSchema,
  }),
  enrolments: z.array(
    z.object({
      courseTitle: z.string(),
      status: z.string(),
      source: z.string(),
      enrolledAt: z.iso.datetime(),
      completedAt: z.iso.datetime().nullable(),
      revokedAt: z.iso.datetime().nullable(),
    }),
  ),
  lessonProgress: z.array(
    z.object({
      courseId: z.uuid(),
      lessonId: z.uuid(),
      completedAt: z.iso.datetime(),
    }),
  ),
  notes: z.array(
    z.object({
      courseId: z.uuid(),
      lessonId: z.uuid(),
      body: z.string(),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  discussions: z.object({
    threads: z.array(
      z.object({
        courseId: z.uuid(),
        lessonId: z.uuid(),
        title: z.string(),
        status: z.string(),
        createdAt: z.iso.datetime(),
      }),
    ),
    posts: z.array(
      z.object({
        threadId: z.uuid(),
        body: z.string(),
        status: z.string(),
        createdAt: z.iso.datetime(),
      }),
    ),
  }),
  quizAttempts: z.array(
    z.object({
      courseId: z.uuid(),
      attemptNumber: z.number().int(),
      status: z.string(),
      scorePercent: z.number().int().nullable(),
      passed: z.boolean().nullable(),
      submittedAt: z.iso.datetime().nullable(),
    }),
  ),
  assignmentSubmissions: z.array(
    z.object({
      courseId: z.uuid(),
      attemptNumber: z.number().int(),
      status: z.string(),
      submittedAt: z.iso.datetime(),
    }),
  ),
  certificates: z.array(
    z.object({
      code: z.string(),
      status: z.string(),
      issuedAt: z.iso.datetime(),
      revokedAt: z.iso.datetime().nullable(),
    }),
  ),
  orders: z.array(
    z.object({
      id: z.uuid(),
      status: z.string(),
      totalMinor: z.number().int(),
      currency: z.string(),
      createdAt: z.iso.datetime(),
      payments: z.array(
        z.object({
          status: z.string(),
          amountMinor: z.number().int(),
          currency: z.string(),
          createdAt: z.iso.datetime(),
        }),
      ),
    }),
  ),
  reviews: z.array(
    z.object({
      courseTitle: z.string(),
      rating: z.number().int(),
      body: z.string(),
      status: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export type AccountExportDto = z.infer<typeof accountExportSchema>;

/** dtg-account-export-<yyyy-mm-dd>.json — mirrors the route's Content-Disposition. */
export function accountExportFilename(generatedAt: string): string {
  return `dtg-account-export-${generatedAt.slice(0, 10)}.json`;
}
