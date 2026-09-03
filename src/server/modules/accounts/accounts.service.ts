import {
  ACCOUNT_NOT_ACTIVE,
  EMAIL_IN_USE,
  EMAIL_UNCHANGED,
  INVALID_CREDENTIALS,
  LOCALES,
  OWNER_DELETE_FORBIDDEN,
  OWNER_EMAIL_RESERVED,
  LOCALE_DEFAULT,
  type AccountProfileDto,
  type ChangeEmailInput,
  type ChangePasswordInput,
  type LocaleValue,
  type UpdateAccountProfileInput,
} from "@/contracts/accounts";
import { getServerEnv } from "@/server/config/env";
import { auth } from "@/server/auth/auth";
import { isReservedOwnerEmail } from "@/server/auth/registration-policy";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import {
  ACCOUNT_AUDIT,
  ACCOUNT_RETENTION_POLICY,
  anonymizeIdentity,
  buildAccountExportDocument,
  evaluateAccountDeletion,
  evaluateEmailChange,
  evaluatePasswordChange,
  hashedEmailIdentifier,
  mergeNotificationPrefs,
  normalizeUpdate,
} from "@/server/modules/accounts/accounts.logic";

// Authorization model: every function is called from /api/v1/account routes
// after requireAuthenticatedUser(headers), and every query is pinned to that
// user id — an account holder can only ever read/mutate their own account.
// Privileged role changes are NOT part of this module (owner console + auth
// hooks own those); the only role-aware guard here is refusing self-deletion
// for the OWNER account.

/**
 * Profile.locale is a free VarChar(16) column; only the supported locales
 * satisfy the DTO enum. Anything missing/unknown reads as the default so a
 * legacy row can never break the profile payload.
 */
function normalizeStoredLocale(stored: string | null | undefined): LocaleValue {
  return (LOCALES as readonly string[]).includes(stored ?? "")
    ? (stored as LocaleValue)
    : LOCALE_DEFAULT;
}

/**
 * The signed-in account holder's profile + quick-badge stats.
 *
 * Query budget: 3 reads.
 * 1. user + profile in ONE joined read (profile falls back to defaults when
 *    the row is somehow missing — pre-foundation users).
 * 2. enrolment counts grouped by status (enrolment + completed tiles).
 * 3. ACTIVE certificate count.
 */
export async function getAccountProfile(userId: string): Promise<AccountProfileDto> {
  const [user, enrolmentCounts, certificateCount] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        role: true,
        createdAt: true,
        profile: {
          select: {
            displayName: true,
            bio: true,
            countryCode: true,
            locale: true,
            timezone: true,
            notificationPrefs: true,
          },
        },
      },
    }),
    // Dashboard-consistent semantics: enrolled = non-REVOKED, completed = COMPLETED.
    db.enrolment.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
    }),
    db.certificate.count({ where: { userId, status: "ACTIVE" } }),
  ]);

  if (!user) throw new ApiError(404, "NOT_FOUND", "The account was not found.");

  const countFor = (status: string) =>
    enrolmentCounts.find((row) => row.status === status)?._count._all ?? 0;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    joinedAt: user.createdAt.toISOString(),
    profile: {
      displayName: user.profile?.displayName ?? user.name,
      bio: user.profile?.bio ?? null,
      countryCode: user.profile?.countryCode ?? null,
      locale: normalizeStoredLocale(user.profile?.locale),
      timezone: user.profile?.timezone ?? "UTC",
      notificationPrefs: mergeNotificationPrefs(user.profile?.notificationPrefs, undefined),
    },
    stats: {
      enrolmentCount: countFor("ACTIVE") + countFor("COMPLETED"),
      completedCourseCount: countFor("COMPLETED"),
      certificateCount,
    },
  };
}

/**
 * Applies an allowlisted profile update. Unknown fields were already rejected
 * by the strict contract schema; this function writes ONLY the normalized
 * fields. `name` is mirrored onto User.name (better-auth's session copy
 * refreshes on next fetch) and Profile.displayName.
 *
 * One transaction: upsert (guarantee the Profile row) + conditional writes +
 * the account.profile.updated audit row.
 */
export async function updateAccountProfile(
  userId: string,
  input: UpdateAccountProfileInput,
  requestId: string,
): Promise<AccountProfileDto> {
  const update = normalizeUpdate(input);

  await db.$transaction(async (tx) => {
    // The auth user.hook creates Profile rows on sign-up; the upsert only
    // repairs rows that predate that hook. displayName falls back to the
    // current User.name so the NOT NULL column is always satisfied.
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { name: true, profile: { select: { notificationPrefs: true } } },
    });
    if (!user) throw new ApiError(404, "NOT_FOUND", "The account was not found.");

    const mergedPrefs = update.notificationPrefs
      ? mergeNotificationPrefs(user.profile?.notificationPrefs, update.notificationPrefs)
      : undefined;

    await tx.profile.upsert({
      where: { userId },
      create: { userId, displayName: update.name ?? user.name },
      update: {},
    });

    await tx.profile.update({
      where: { userId },
      data: {
        ...(update.name !== undefined ? { displayName: update.name } : {}),
        ...(update.bio !== undefined ? { bio: update.bio } : {}),
        ...(update.countryCode !== undefined ? { countryCode: update.countryCode } : {}),
        ...(update.locale !== undefined ? { locale: update.locale } : {}),
        ...(mergedPrefs ? { notificationPrefs: mergedPrefs } : {}),
      },
      select: { id: true },
    });

    if (update.name !== undefined) {
      await tx.user.update({
        where: { id: userId },
        data: { name: update.name },
        select: { id: true },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: ACCOUNT_AUDIT.profileUpdated,
        entityType: "Profile",
        entityId: userId,
        requestId,
        metadata: {
          // Field names only — never the values (bios/names are personal data).
          fields: Object.keys(update),
        },
      },
      select: { id: true },
    });
  });

  return getAccountProfile(userId);
}

/**
 * Verifies the current password, rotates the credential hash, and revokes
 * every OTHER session (the caller's own session survives so the current tab
 * is not interrupted). One transaction after the argon verify: hash update +
 * session sweep + audit.
 *
 * A missing credential account is reported with the same INVALID_CREDENTIALS
 * code as a wrong password — it must not leak whether an account is
 * OAuth-only.
 */
export async function changePassword(
  userId: string,
  sessionId: string,
  input: ChangePasswordInput,
  requestId: string,
): Promise<{ sessionsRevoked: number }> {
  const policy = evaluatePasswordChange(input.newPassword, input.currentPassword);
  if (!policy.ok) {
    // Length problems are normally caught by the contract schema; the
    // unchanged-password rule is the one this check uniquely owns.
    throw new ApiError(
      422,
      policy.code,
      policy.code === "PASSWORD_UNCHANGED"
        ? "The new password must be different from the current password."
        : "The new password does not meet the length requirements.",
    );
  }

  const credential = await db.account.findFirst({
    where: { userId, providerId: "credential", issuer: "local:credential" },
    select: { id: true, password: true },
  });
  const verified =
    credential?.password !== null &&
    credential?.password !== undefined &&
    (await verifyPassword({ hash: credential.password, password: input.currentPassword }));
  if (!credential || !verified) {
    throw new ApiError(400, INVALID_CREDENTIALS, "Current password is incorrect.");
  }

  const sessionsRevoked = await db.$transaction(async (tx) => {
    await tx.account.update({
      where: { id: credential.id },
      data: { password: await hashPassword(input.newPassword) },
      select: { id: true },
    });

    const revoked = await tx.session.deleteMany({
      where: { userId, id: { not: sessionId } },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: ACCOUNT_AUDIT.passwordChanged,
        entityType: "User",
        entityId: userId,
        requestId,
        metadata: { sessionsRevoked: revoked.count },
      },
      select: { id: true },
    });

    return revoked.count;
  });

  return { sessionsRevoked };
}

/**
 * Starts a verified email-change flow behind a current-password check. The
 * existing address remains active until the owner clicks the link delivered
 * to the new address, so a typo or mail outage cannot lock the owner out.
 *
 * Guards, in order: unchanged address, the reserved owner email (students
 * may not claim it; the owner may move back onto it), credential proof, and
 * the emailNormalized UNIQUE constraint. Better Auth owns the signed,
 * expiring verification token and performs the eventual identity update.
 */
export async function changeEmail(
  userId: string,
  input: ChangeEmailInput,
  requestId: string,
  requestHeaders: Headers,
): Promise<{ verificationRequested: true }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      accounts: {
        where: { providerId: "credential", issuer: "local:credential" },
        take: 1,
        select: { password: true },
      },
    },
  });
  if (!user) throw new ApiError(404, "NOT_FOUND", "The account was not found.");

  const decision = evaluateEmailChange(input.newEmail, user.email);
  if (!decision.ok) {
    throw new ApiError(
      422,
      decision.code,
      "The new email must be different from the current email.",
    );
  }
  const newEmail = decision.normalizedEmail;

  if (user.role !== "OWNER" && isReservedOwnerEmail(newEmail, getServerEnv().OWNER_EMAIL)) {
    throw new ApiError(
      422,
      OWNER_EMAIL_RESERVED,
      "This email is reserved and cannot be used.",
    );
  }

  const credential = user.accounts[0];
  const verified =
    credential?.password !== null &&
    credential?.password !== undefined &&
    (await verifyPassword({ hash: credential.password, password: input.currentPassword }));
  if (!credential || !verified) {
    throw new ApiError(400, INVALID_CREDENTIALS, "Current password is incorrect.");
  }

  const clash = await db.user.findUnique({
    where: { emailNormalized: newEmail },
    select: { id: true },
  });
  if (clash && clash.id !== userId) {
    throw new ApiError(422, EMAIL_IN_USE, "That email is already in use by another account.");
  }

  await auth.api.changeEmail({
    headers: requestHeaders,
    body: { newEmail, callbackURL: "/owner/settings" },
  });

  await db.auditLog.create({
    data: {
      actorUserId: userId,
      action: ACCOUNT_AUDIT.emailChangeRequested,
      entityType: "User",
      entityId: userId,
      requestId,
      // The address itself is personal data — the audit records the event only.
      metadata: {},
    },
    select: { id: true },
  });

  return { verificationRequested: true };
}

/**
 * Full account data export (privacy right of access). Bounded reads, all
 * pinned to the caller's own rows and executed in two parallel rounds.
 *
 * Query budget: 11 reads in 2 rounds. The task brief's content list spans 11
 * distinct tables (user+profile, enrolments, progress, notes, threads, posts,
 * quiz attempts, submissions, certificates, orders+payments, reviews), so 8
 * was not reachable without dropping a required section; the honest count is
 * documented here instead. Excluded on purpose: quiz question snapshots
 * (server-side answer keys) and provider webhook payloads.
 */
export async function exportAccountData(userId: string): Promise<ReturnType<typeof buildAccountExportDocument>> {
  const [user, enrolments, progressRows, notes, threads, posts, quizAttempts, submissions] =
    await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          role: true,
          status: true,
          createdAt: true,
          profile: {
            select: {
              displayName: true,
              bio: true,
              countryCode: true,
              locale: true,
              timezone: true,
              notificationPrefs: true,
            },
          },
        },
      }),
      db.enrolment.findMany({
        where: { userId },
        select: {
          status: true,
          source: true,
          createdAt: true,
          completedAt: true,
          revokedAt: true,
          course: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.lessonProgress.findMany({
        where: { userId },
        select: { courseId: true, lessonId: true, completedAt: true },
        orderBy: { completedAt: "desc" },
      }),
      db.lessonNote.findMany({
        where: { userId },
        select: {
          courseId: true,
          lessonId: true,
          body: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      db.discussionThread.findMany({
        where: { userId },
        select: {
          courseId: true,
          lessonId: true,
          title: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      db.discussionPost.findMany({
        where: { userId },
        select: { threadId: true, body: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      db.quizAttempt.findMany({
        where: { userId },
        select: {
          courseId: true,
          attemptNumber: true,
          status: true,
          scorePercent: true,
          passed: true,
          submittedAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      db.assignmentSubmission.findMany({
        where: { userId },
        select: {
          courseId: true,
          attemptNumber: true,
          status: true,
          submittedAt: true,
        },
        orderBy: { submittedAt: "desc" },
      }),
    ]);

  const [certificates, orders, reviews] = await Promise.all([
    db.certificate.findMany({
      where: { userId },
      select: { code: true, status: true, issuedAt: true, revokedAt: true },
      orderBy: { issuedAt: "desc" },
    }),
    db.order.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        totalMinor: true,
        currency: true,
        createdAt: true,
        payments: {
          select: { status: true, amountMinor: true, currency: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.review.findMany({
      where: { userId },
      select: {
        rating: true,
        body: true,
        status: true,
        createdAt: true,
        course: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!user) throw new ApiError(404, "NOT_FOUND", "The account was not found.");

  return buildAccountExportDocument({
    account: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    },
    profile: {
      displayName: user.profile?.displayName ?? user.name,
      bio: user.profile?.bio ?? null,
      countryCode: user.profile?.countryCode ?? null,
      locale: normalizeStoredLocale(user.profile?.locale),
      timezone: user.profile?.timezone ?? "UTC",
      notificationPrefs: mergeNotificationPrefs(user.profile?.notificationPrefs, undefined),
    },
    enrolments: enrolments.map((row) => ({
      courseTitle: row.course.title,
      status: row.status,
      source: row.source,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      revokedAt: row.revokedAt,
    })),
    lessonProgress: progressRows,
    notes,
    threads,
    posts,
    quizAttempts,
    assignmentSubmissions: submissions,
    certificates,
    orders,
    reviews: reviews.map((row) => ({
      courseTitle: row.course.title,
      rating: row.rating,
      body: row.body,
      status: row.status,
      createdAt: row.createdAt,
    })),
  });
}

/**
 * Deletion policy (retention "v1", mirrored into the audit metadata):
 *
 * DELETED in one transaction:
 * - User: status -> DELETED, deletedAt stamped, name/image anonymized,
 *   email + emailNormalized -> the deterministic `deleted-<id8>@deleted.invalid`
 *   (keeps the UNIQUE constraints holding without releasing the address).
 * - Profile: display name "Deleted User"; bio/countryCode/avatarKey cleared;
 *   locale reset to the default.
 * - auth sessions (the caller is signed out everywhere), auth Accounts
 *   (credential + any OAuth links), Verifications (pending tokens for the old
 *   email — better-auth hashes identifiers, see hashedEmailIdentifier),
 *   Notifications, and LessonNotes (private PII).
 *
 * KEPT as financial & integrity records (identities are anonymized via the
 * User row, so nothing points at the person anymore): Enrolments, Orders,
 * Payments, Certificates, Reviews, LessonProgress, Discussions, and
 * assessment records. Deleting these would break certificate verification,
 * order history, and course aggregates.
 */
export async function deleteAccount(userId: string, requestId: string): Promise<{ deleted: true }> {
  // Guard read (outside the tx): the pure decision needs role + status + the
  // old email for the verification sweep.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true, email: true },
  });
  if (!user) throw new ApiError(404, "NOT_FOUND", "The account was not found.");

  const decision = evaluateAccountDeletion(user);
  if (!decision.ok) {
    throw new ApiError(
      422,
      decision.code,
      decision.code === OWNER_DELETE_FORBIDDEN
        ? "The platform owner account cannot be deleted."
        : "Suspended accounts cannot be deleted. Contact support first.",
    );
  }

  const { anonymizedName, anonymizedEmail } = anonymizeIdentity(userId);

  await db.$transaction(async (tx) => {
    // Conditional update: if the status flipped (e.g. an owner suspended the
    // account between the guard and the write) nothing is anonymized.
    const anonymized = await tx.user.updateMany({
      where: { id: userId, status: "ACTIVE" },
      data: {
        status: "DELETED",
        deletedAt: new Date(),
        name: anonymizedName,
        email: anonymizedEmail,
        emailNormalized: anonymizedEmail,
        image: null,
      },
    });
    if (anonymized.count === 0) {
      throw new ApiError(
        409,
        ACCOUNT_NOT_ACTIVE,
        "The account state changed; deletion was not completed.",
      );
    }

    await tx.profile.upsert({
      where: { userId },
      create: { userId, displayName: anonymizedName },
      update: {
        displayName: anonymizedName,
        bio: null,
        countryCode: null,
        avatarKey: null,
        locale: LOCALE_DEFAULT,
      },
    });

    await tx.session.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.verification.deleteMany({
      where: { identifier: { in: [user.email, hashedEmailIdentifier(user.email)] } },
    });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.lessonNote.deleteMany({ where: { userId } });

    await tx.auditLog.create({
      data: {
        // The actor row is the (now anonymized) user; AuditLog.actor is
        // SetNull so a later hard delete would keep the audit trail.
        actorUserId: userId,
        action: ACCOUNT_AUDIT.deleted,
        entityType: "User",
        entityId: userId,
        requestId,
        metadata: { retentionPolicy: ACCOUNT_RETENTION_POLICY },
      },
      select: { id: true },
    });
  });

  return { deleted: true };
}
