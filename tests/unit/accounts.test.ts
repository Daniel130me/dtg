import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  accountExportFilename,
  accountProfileSchema,
  BIO_MAX,
  changeEmailSchema,
  changePasswordSchema,
  DELETION_CONFIRMATION_WORD,
  NAME_MAX,
  NOTIFICATION_PREFS_DEFAULTS,
  updateAccountProfileSchema,
} from "@/contracts/accounts";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import {
  ACCOUNT_AUDIT,
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  ACCOUNT_RETENTION_POLICY,
  anonymizeIdentity,
  buildAccountExportDocument,
  evaluateAccountDeletion,
  evaluateDeletionConfirmation,
  evaluateEmailChange,
  evaluatePasswordChange,
  hashedEmailIdentifier,
  mergeNotificationPrefs,
  normalizeUpdate,
} from "@/server/modules/accounts/accounts.logic";

// Pure account rules: profile update normalization/mass-assignment safety,
// notification-prefs merging, the password policy, deletion guards, the
// deterministic anonymization, and the export document builder. Nothing here
// touches the database (accounts.logic.ts imports contracts + node:crypto only).

const USER_A = "fb2ecc82-1111-4111-8111-111111111111";
const USER_B = "0c9d3e77-2222-4222-8222-222222222222";
const DIFFERENT_ID = "5f8a1c33-3333-4333-8333-333333333333";

describe("profile update contract", () => {
  it("accepts a partial allowlisted update", () => {
    const parsed = updateAccountProfileSchema.parse({
      name: "  Ada Lovelace  ",
      bio: "Engineer",
      countryCode: "NG",
      locale: "fr",
      notificationPrefs: { newContent: true },
    });
    assert.equal(parsed.name, "Ada Lovelace");
    assert.deepEqual(parsed.notificationPrefs, { newContent: true });
  });

  it("rejects unknown top-level keys (mass-assignment safe)", () => {
    assert.throws(() => updateAccountProfileSchema.parse({ role: "OWNER" }));
    assert.throws(() => updateAccountProfileSchema.parse({ email: "owner@example.test" }));
    assert.throws(() => updateAccountProfileSchema.parse({ status: "DELETED" }));
  });

  it("rejects unknown notification-pref keys", () => {
    assert.throws(() =>
      updateAccountProfileSchema.parse({ notificationPrefs: { adminChannel: true } }),
    );
  });

  it("restricts the locale to the supported set", () => {
    assert.throws(() => updateAccountProfileSchema.parse({ locale: "de" }));
    assert.equal(updateAccountProfileSchema.parse({ locale: "es" }).locale, "es");
  });

  it("normalizes the country code to uppercase and enforces the 2-letter shape", () => {
    assert.equal(updateAccountProfileSchema.parse({ countryCode: "ng" }).countryCode, "NG");
    assert.equal(updateAccountProfileSchema.parse({ countryCode: " ke " }).countryCode, "KE");
    assert.throws(() => updateAccountProfileSchema.parse({ countryCode: "NGA" }));
    assert.throws(() => updateAccountProfileSchema.parse({ countryCode: "N1" }));
  });

  it("enforces the bio and name display limits", () => {
    assert.throws(() => updateAccountProfileSchema.parse({ bio: "x".repeat(BIO_MAX + 1) }));
    assert.equal(updateAccountProfileSchema.parse({ bio: "x".repeat(BIO_MAX) }).bio, "x".repeat(BIO_MAX));
    assert.throws(() => updateAccountProfileSchema.parse({ name: "x".repeat(NAME_MAX + 1) }));
    assert.throws(() => updateAccountProfileSchema.parse({ name: "   " }));
  });

  it("accepts null to clear bio/countryCode", () => {
    const parsed = updateAccountProfileSchema.parse({ bio: null, countryCode: null });
    assert.equal(parsed.bio, null);
    assert.equal(parsed.countryCode, null);
  });

  it("normalizes the parsed body: undefined stripped, empty bio cleared", () => {
    const normalized = normalizeUpdate(updateAccountProfileSchema.parse({ name: "Ada", bio: "" }));
    assert.deepEqual(normalized, { name: "Ada", bio: null });

    const allAbsent = normalizeUpdate(updateAccountProfileSchema.parse({}));
    assert.deepEqual(allAbsent, {});
  });
});

describe("notification preference merging", () => {
  it("falls back to the defaults for a null column", () => {
    assert.deepEqual(mergeNotificationPrefs(null, undefined), NOTIFICATION_PREFS_DEFAULTS);
    assert.deepEqual(mergeNotificationPrefs(undefined, undefined), NOTIFICATION_PREFS_DEFAULTS);
  });

  it("drops unknown or non-boolean values from stored JSON", () => {
    const merged = mergeNotificationPrefs(
      { emailNotifications: false, courseUpdates: "yes", rogueKey: true, newContent: 1 },
      undefined,
    );
    assert.equal(merged.emailNotifications, false);
    assert.equal(merged.courseUpdates, NOTIFICATION_PREFS_DEFAULTS.courseUpdates);
    assert.equal(merged.newContent, NOTIFICATION_PREFS_DEFAULTS.newContent);
    assert.equal("rogueKey" in merged, false);
  });

  it("applies the patch over the stored values and always returns the full document", () => {
    const merged = mergeNotificationPrefs(
      { emailNotifications: false, promotionalEmails: true },
      { emailNotifications: true },
    );
    assert.deepEqual(merged, {
      emailNotifications: true,
      courseUpdates: true,
      newContent: false,
      promotionalEmails: true,
    });
  });
});

describe("password policy", () => {
  it("pins the contract limits to better-auth's own password policy", () => {
    // A password accepted by the account flow must never be rejected again at
    // sign-in, so the constants must be the SAME values auth was configured with.
    assert.equal(ACCOUNT_PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH);
    assert.equal(ACCOUNT_PASSWORD_MAX_LENGTH, PASSWORD_MAX_LENGTH);
  });

  it("rejects a new password shorter than the minimum", () => {
    const decision = evaluatePasswordChange("a".repeat(ACCOUNT_PASSWORD_MIN_LENGTH - 1), "old-password");
    assert.deepEqual(decision, { ok: false, code: "PASSWORD_TOO_SHORT" });
  });

  it("rejects a new password longer than the maximum", () => {
    const decision = evaluatePasswordChange("a".repeat(ACCOUNT_PASSWORD_MAX_LENGTH + 1), "old-password");
    assert.deepEqual(decision, { ok: false, code: "PASSWORD_TOO_LONG" });
  });

  it("rejects a new password identical to the current one", () => {
    const decision = evaluatePasswordChange("current-password-123", "current-password-123");
    assert.deepEqual(decision, { ok: false, code: "PASSWORD_UNCHANGED" });
  });

  it("accepts a genuinely new password at the boundary lengths", () => {
    assert.deepEqual(
      evaluatePasswordChange("a".repeat(ACCOUNT_PASSWORD_MIN_LENGTH), "old-password"),
      { ok: true },
    );
    assert.deepEqual(
      evaluatePasswordChange("a".repeat(ACCOUNT_PASSWORD_MAX_LENGTH), "old-password"),
      { ok: true },
    );
  });

  it("keeps the change-password contract aligned with the policy", () => {
    assert.throws(() => changePasswordSchema.parse({ currentPassword: "x", newPassword: "short" }));
    assert.throws(() => changePasswordSchema.parse({ currentPassword: "", newPassword: "a".repeat(12) }));
    const parsed = changePasswordSchema.parse({
      currentPassword: "current-password-123",
      newPassword: "a".repeat(ACCOUNT_PASSWORD_MIN_LENGTH),
    });
    assert.equal(parsed.currentPassword, "current-password-123");
  });
});

describe("email change policy", () => {
  it("normalizes a genuinely new address", () => {
    assert.deepEqual(evaluateEmailChange(" New.Owner@Example.COM ", "owner@example.com"), {
      ok: true,
      normalizedEmail: "new.owner@example.com",
    });
  });

  it("rejects the current address regardless of casing or whitespace", () => {
    assert.deepEqual(evaluateEmailChange(" OWNER@example.com ", "owner@example.com"), {
      ok: false,
      code: "EMAIL_UNCHANGED",
    });
  });

  it("validates and normalizes the email-change request body", () => {
    const parsed = changeEmailSchema.parse({
      currentPassword: "current-password-123",
      newEmail: " New.Owner@Example.COM ",
    });
    assert.equal(parsed.newEmail, "new.owner@example.com");
    assert.throws(() => changeEmailSchema.parse({ currentPassword: "", newEmail: "invalid" }));
    assert.throws(() =>
      changeEmailSchema.parse({
        currentPassword: "current-password-123",
        newEmail: "owner@example.com",
        role: "OWNER",
      }),
    );
  });
});

describe("deletion guards", () => {
  it("requires the exact confirmation word (case- and whitespace-sensitive)", () => {
    assert.deepEqual(evaluateDeletionConfirmation(DELETION_CONFIRMATION_WORD), { ok: true });
    assert.equal(DELETION_CONFIRMATION_WORD, "DELETE");
    assert.deepEqual(evaluateDeletionConfirmation("delete"), {
      ok: false,
      code: "DELETION_CONFIRMATION_MISMATCH",
    });
    assert.deepEqual(evaluateDeletionConfirmation("DELETE "), {
      ok: false,
      code: "DELETION_CONFIRMATION_MISMATCH",
    });
    assert.deepEqual(evaluateDeletionConfirmation(""), {
      ok: false,
      code: "DELETION_CONFIRMATION_MISMATCH",
    });
  });

  it("never deletes the platform owner account", () => {
    const decision = evaluateAccountDeletion({ role: "OWNER", status: "ACTIVE" });
    assert.deepEqual(decision, { ok: false, code: "OWNER_DELETE_FORBIDDEN" });
  });

  it("refuses non-ACTIVE accounts", () => {
    assert.deepEqual(evaluateAccountDeletion({ role: "STUDENT", status: "SUSPENDED" }), {
      ok: false,
      code: "ACCOUNT_NOT_ACTIVE",
    });
    assert.deepEqual(evaluateAccountDeletion({ role: "STUDENT", status: "DELETED" }), {
      ok: false,
      code: "ACCOUNT_NOT_ACTIVE",
    });
  });

  it("allows an ACTIVE student to delete their own account", () => {
    assert.deepEqual(evaluateAccountDeletion({ role: "STUDENT", status: "ACTIVE" }), { ok: true });
  });
});

describe("anonymized identity", () => {
  it("is deterministic for the same userId", () => {
    const first = anonymizeIdentity(USER_A);
    const second = anonymizeIdentity(USER_A);
    assert.deepEqual(first, second);
    assert.equal(first.anonymizedName, "Deleted User");
    assert.equal(first.anonymizedEmail, "deleted-fb2ecc82@deleted.invalid");
  });

  it("keeps distinct userIds distinct (UNIQUE constraint holds)", () => {
    const a = anonymizeIdentity(USER_A);
    const b = anonymizeIdentity(USER_B);
    const c = anonymizeIdentity(DIFFERENT_ID);
    assert.notEqual(a.anonymizedEmail, b.anonymizedEmail);
    assert.notEqual(b.anonymizedEmail, c.anonymizedEmail);
    // All anonymized emails live in the reserved .invalid TLD.
    for (const identity of [a, b, c]) {
      assert.ok(identity.anonymizedEmail.endsWith("@deleted.invalid"));
    }
  });
});

describe("hashed verification identifier", () => {
  it("is the base64url SHA-256 of the email (better-auth storeIdentifier: hashed)", () => {
    const email = "learner@example.test";
    // Independent recomputation via node:crypto in the test itself.
    const digest = createHash("sha256").update(email, "utf8").digest("base64url");
    assert.equal(hashedEmailIdentifier(email), digest);
  });

  it("is deterministic and distinct per email", () => {
    assert.equal(hashedEmailIdentifier("a@b.test"), hashedEmailIdentifier("a@b.test"));
    assert.notEqual(hashedEmailIdentifier("a@b.test"), hashedEmailIdentifier("c@d.test"));
  });
});

describe("account export builder", () => {
  const generatedAt = new Date("2026-09-02T12:00:00.000Z");
  const baseInput = {
    account: {
      id: USER_A,
      name: "Ada Lovelace",
      email: "learner@example.test",
      emailVerified: true,
      role: "STUDENT",
      status: "ACTIVE",
      createdAt: new Date("2026-01-15T08:30:00.000Z"),
    },
    profile: {
      displayName: "Ada Lovelace",
      bio: "Engineer",
      countryCode: "NG",
      locale: "en",
      timezone: "UTC",
      notificationPrefs: NOTIFICATION_PREFS_DEFAULTS,
    },
    enrolments: [
      {
        courseTitle: "Next.js Masterclass",
        status: "COMPLETED",
        source: "PURCHASE",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        completedAt: new Date("2026-03-01T00:00:00.000Z"),
        revokedAt: null,
      },
    ],
    lessonProgress: [
      { courseId: USER_A, lessonId: USER_B, completedAt: new Date("2026-02-10T00:00:00.000Z") },
    ],
    notes: [
      {
        courseId: USER_A,
        lessonId: USER_B,
        body: "Remember the river",
        createdAt: new Date("2026-02-11T00:00:00.000Z"),
        updatedAt: new Date("2026-02-12T00:00:00.000Z"),
      },
    ],
    threads: [
      {
        courseId: USER_A,
        lessonId: USER_B,
        title: "How does streaming work?",
        status: "ACTIVE",
        createdAt: new Date("2026-02-13T00:00:00.000Z"),
      },
    ],
    posts: [
      {
        threadId: USER_A,
        body: "Following up on my question.",
        status: "ACTIVE",
        createdAt: new Date("2026-02-14T00:00:00.000Z"),
      },
    ],
    quizAttempts: [
      {
        courseId: USER_A,
        attemptNumber: 1,
        status: "SUBMITTED",
        scorePercent: 90,
        passed: true,
        submittedAt: new Date("2026-02-15T00:00:00.000Z"),
      },
    ],
    assignmentSubmissions: [
      {
        courseId: USER_A,
        attemptNumber: 1,
        status: "GRADED",
        submittedAt: new Date("2026-02-16T00:00:00.000Z"),
      },
    ],
    certificates: [
      {
        code: "CERT-123",
        status: "ACTIVE",
        issuedAt: new Date("2026-03-02T00:00:00.000Z"),
        revokedAt: null,
      },
    ],
    orders: [
      {
        id: USER_A,
        status: "PAID",
        totalMinor: 15000,
        currency: "USD",
        createdAt: new Date("2026-01-31T00:00:00.000Z"),
        payments: [
          {
            status: "SUCCEEDED",
            amountMinor: 15000,
            currency: "USD",
            createdAt: new Date("2026-01-31T00:01:00.000Z"),
          },
        ],
      },
    ],
    reviews: [
      {
        courseTitle: "Next.js Masterclass",
        rating: 5,
        body: "Great course",
        status: "VISIBLE",
        createdAt: new Date("2026-03-03T00:00:00.000Z"),
      },
    ],
  };

  it("builds the full document with ISO timestamps and raw enum labels", () => {
    const document = buildAccountExportDocument(baseInput, generatedAt);

    assert.equal(document.generatedAt, "2026-09-02T12:00:00.000Z");
    assert.equal(document.retentionPolicy, ACCOUNT_RETENTION_POLICY);
    assert.equal(document.account.joinedAt, "2026-01-15T08:30:00.000Z");
    assert.deepEqual(document.account, {
      id: USER_A,
      name: "Ada Lovelace",
      email: "learner@example.test",
      emailVerified: true,
      role: "STUDENT",
      status: "ACTIVE",
      joinedAt: "2026-01-15T08:30:00.000Z",
    });
    assert.deepEqual(document.enrolments, [
      {
        courseTitle: "Next.js Masterclass",
        status: "COMPLETED", // raw label, verbatim
        source: "PURCHASE",
        enrolledAt: "2026-02-01T00:00:00.000Z",
        completedAt: "2026-03-01T00:00:00.000Z",
        revokedAt: null,
      },
    ]);
    assert.deepEqual(document.orders[0].payments, [
      {
        status: "SUCCEEDED",
        amountMinor: 15000,
        currency: "USD",
        createdAt: "2026-01-31T00:01:00.000Z",
      },
    ]);
    assert.equal(document.notes[0].body, "Remember the river");
    assert.equal(document.discussions.posts[0].threadId, USER_A);
    assert.equal(document.quizAttempts[0].passed, true);
    assert.equal(document.certificates[0].revokedAt, null);
    assert.equal(document.reviews[0].courseTitle, "Next.js Masterclass");
  });

  it("defaults generatedAt to now and keeps every section present even when empty", () => {
    const document = buildAccountExportDocument({
      ...baseInput,
      enrolments: [],
      lessonProgress: [],
      notes: [],
      threads: [],
      posts: [],
      quizAttempts: [],
      assignmentSubmissions: [],
      certificates: [],
      orders: [],
      reviews: [],
    });

    assert.ok(!Number.isNaN(Date.parse(document.generatedAt)));
    assert.deepEqual(document.enrolments, []);
    assert.deepEqual(document.lessonProgress, []);
    assert.deepEqual(document.discussions.threads, []);
    assert.deepEqual(document.discussions.posts, []);
  });

  it("matches the pinned audit vocabulary", () => {
    assert.deepEqual(ACCOUNT_AUDIT, {
      profileUpdated: "account.profile.updated",
      passwordChanged: "account.password.changed",
      emailChangeRequested: "account.email.change_requested",
      deleted: "account.deleted",
    });
  });
});

describe("account export download naming", () => {
  it("derives the filename from the generation date", () => {
    assert.equal(
      accountExportFilename("2026-09-02T12:00:00.000Z"),
      "dtg-account-export-2026-09-02.json",
    );
  });
});

describe("account profile wire contract", () => {
  it("parses a representative payload and rejects enum drift", () => {
    const payload = {
      id: USER_A,
      name: "Ada Lovelace",
      email: "learner@example.test",
      emailVerified: false,
      role: "STUDENT",
      joinedAt: "2026-01-15T08:30:00.000Z",
      profile: {
        displayName: "Ada Lovelace",
        bio: null,
        countryCode: null,
        locale: "en",
        timezone: "UTC",
        notificationPrefs: NOTIFICATION_PREFS_DEFAULTS,
      },
      stats: { enrolmentCount: 2, completedCourseCount: 1, certificateCount: 1 },
    };
    assert.equal(accountProfileSchema.parse(payload).profile.locale, "en");
    assert.throws(() => accountProfileSchema.parse({ ...payload, profile: { ...payload.profile, locale: "de" } }));
    assert.throws(() => accountProfileSchema.parse({ ...payload, role: "ADMIN" }));
    assert.throws(() =>
      accountProfileSchema.parse({ ...payload, stats: { ...payload.stats, enrolmentCount: -1 } }),
    );
  });
});
