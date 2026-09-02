import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { AuthenticationEmailInput } from "@/server/email/authentication-email";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const email = `auth-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
const password = "correct-horse-battery-staple";
const startedAt = new Date();

describe("authentication integration", { skip: !testDatabaseUrl }, () => {
  let database: PrismaClient;
  let service: Awaited<typeof import("@/server/auth/auth")>["auth"];
  const deliveries: AuthenticationEmailInput[] = [];

  before(async () => {
    database = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const { createAuthService } = await import("@/server/auth/auth");
    service = createAuthService(database, async (message) => {
      deliveries.push(message);
    });
  });

  after(async () => {
    await database.verification.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await database.user.deleteMany({ where: { emailNormalized: email } });
    await database.$disconnect();
  });

  it("registers only a student with an Argon2id credential and a hashed verification token", async () => {
    await service.api.signUpEmail({
      body: {
        name: "Authentication Test",
        email: email.toUpperCase(),
        password,
        role: "OWNER",
      } as never,
    });

    const user = await database.user.findUniqueOrThrow({
      where: { emailNormalized: email },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerified: true,
        accounts: { select: { password: true, providerId: true } },
        profile: { select: { displayName: true } },
      },
    });
    const verification = await database.verification.findFirstOrThrow({
      where: { createdAt: { gte: startedAt } },
      orderBy: { createdAt: "desc" },
      select: { identifier: true, value: true, expiresAt: true },
    });

    assert.equal(user.email, email);
    assert.equal(user.role, "STUDENT");
    assert.equal(user.emailVerified, false);
    assert.equal(user.profile?.displayName, "Authentication Test");
    assert.equal(user.accounts[0]?.providerId, "credential");
    assert.match(user.accounts[0]?.password ?? "", /^\$argon2id\$/);
    assert.equal(deliveries.length, 1);

    const rawToken = new URL(deliveries[0].actionUrl).searchParams.get("token");
    assert.ok(rawToken);
    assert.notEqual(verification.value, rawToken);
    assert.ok(verification.expiresAt > new Date());

    const { consumeEmailVerificationToken } = await import("@/server/auth/email-verification-token");
    assert.equal(await consumeEmailVerificationToken(database, rawToken), true);
    assert.equal(await consumeEmailVerificationToken(database, rawToken), false);
  });

  it("notifies an existing account without creating a duplicate or verification token", async () => {
    const usersBefore = await database.user.count({ where: { emailNormalized: email } });
    const verificationsBefore = await database.verification.count({
      where: { createdAt: { gte: startedAt } },
    });

    await service.api.signUpEmail({
      body: {
        name: "Duplicate Registration Attempt",
        email,
        password: "a-different-valid-password",
      },
    });

    assert.equal(await database.user.count({ where: { emailNormalized: email } }), usersBefore);
    assert.equal(
      await database.verification.count({ where: { createdAt: { gte: startedAt } } }),
      verificationsBefore,
    );
    assert.equal(deliveries.length, 2);
    const duplicateNotice = deliveries.at(-1);
    assert.ok(duplicateNotice);
    assert.equal(duplicateNotice.to, email);
    assert.equal(duplicateNotice.subject, "Your DTG account already exists");
    assert.equal(new URL(duplicateNotice.actionUrl).pathname, "/login");
  });
});
