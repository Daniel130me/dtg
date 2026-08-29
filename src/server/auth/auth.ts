import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/server/db/client";
import { getServerEnv } from "@/server/config/env";
import {
  sendAuthenticationEmail,
  type AuthenticationEmailInput,
} from "@/server/email/authentication-email";
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "@/server/auth/password";
import { issueEmailVerificationToken } from "@/server/auth/email-verification-token";

const env = getServerEnv();
const DAY_IN_SECONDS = 24 * 60 * 60;

export function createAuthService(
  database: PrismaClient = db,
  sendEmail: (input: AuthenticationEmailInput) => Promise<void> = sendAuthenticationEmail,
) {
  return betterAuth({
    appName: "DTG",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [...env.corsOrigins],
    database: prismaAdapter(database, { provider: "postgresql" }),
    advanced: {
      database: { generateId: false },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
      },
    },
    user: {
      additionalFields: {
        emailNormalized: { type: "string", required: false, input: false },
        role: { type: "string", required: true, defaultValue: "STUDENT", input: false },
        status: { type: "string", required: true, defaultValue: "ACTIVE", input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        await database.auditLog.create({
          data: {
            actorUserId: user.id,
            action: "AUTH_PASSWORD_RESET",
            entityType: "User",
            entityId: user.id,
          },
          select: { id: true },
        });
      },
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your DTG password",
          intro: "A password reset was requested for your DTG account.",
          actionLabel: "Reset password",
          actionUrl: url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url, token }) => {
        await issueEmailVerificationToken(database, user.email, token);
        await sendEmail({
          to: user.email,
          subject: "Verify your DTG email",
          intro: "Confirm your email address to activate your DTG account.",
          actionLabel: "Verify email",
          actionUrl: url,
        });
      },
      afterEmailVerification: async (user) => {
        await database.auditLog.create({
          data: {
            actorUserId: user.id,
            action: "AUTH_EMAIL_VERIFIED",
            entityType: "User",
            entityId: user.id,
          },
          select: { id: true },
        });
      },
    },
    verification: { storeIdentifier: "hashed" },
    session: {
      expiresIn: 7 * DAY_IN_SECONDS,
      updateAge: DAY_IN_SECONDS,
    },
    rateLimit: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              email: user.email.trim().toLowerCase(),
              emailNormalized: user.email.trim().toLowerCase(),
              role: "STUDENT",
              status: "ACTIVE",
            },
          }),
          after: async (user) => {
            await database.$transaction([
              database.profile.create({
                data: { userId: user.id, displayName: user.name },
                select: { id: true },
              }),
              database.auditLog.create({
                data: {
                  actorUserId: user.id,
                  action: "AUTH_REGISTERED",
                  entityType: "User",
                  entityId: user.id,
                },
                select: { id: true },
              }),
            ]);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await database.user.findUnique({
              where: { id: session.userId },
              select: { status: true },
            });
            if (!user || user.status !== "ACTIVE") return false;
            return { data: session };
          },
          after: async (session) => {
            await database.auditLog.create({
              data: {
                actorUserId: session.userId,
                action: "AUTH_SIGNED_IN",
                entityType: "Session",
                entityId: session.id,
              },
              select: { id: true },
            });
          },
        },
        delete: {
          after: async (session) => {
            await database.auditLog.create({
              data: {
                actorUserId: session.userId,
                action: "AUTH_SESSION_REVOKED",
                entityType: "Session",
                entityId: session.id,
              },
              select: { id: true },
            });
          },
        },
      },
    },
  });
}

export const auth = createAuthService();

export type AuthSession = typeof auth.$Infer.Session;
