import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

// Phase 12 security suite (database-backed slice): brute-force behaviour of
// the fixed-window rate limiter that guards login-adjacent and account-
// sensitive endpoints. Requires TEST_DATABASE_URL (isolated database, see
// prisma.test.config.ts); skipped otherwise, like every integration suite.

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe("rate limiter abuse behaviour", { skip: !testDatabaseUrl }, () => {
  let database: typeof import("@/server/db/client").db;
  let consumeRateLimit: typeof import("@/server/http/rate-limit").consumeRateLimit;
  const policy = { namespace: "security-test", limit: 3, windowMs: 60_000 };
  const keyA = `user-a-${Date.now()}`;
  const keyB = `user-b-${Date.now()}`;

  before(async () => {
    Object.assign(process.env, {
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testDatabaseUrl,
    });
    ({ db: database } = await import("@/server/db/client"));
    ({ consumeRateLimit } = await import("@/server/http/rate-limit"));
  });

  after(async () => {
    await database.rateLimitBucket.deleteMany({
      where: { key: { startsWith: "security-test:" } },
    });
    await database?.$disconnect();
  });

  it("admits requests up to the policy limit", async () => {
    for (let i = 0; i < policy.limit; i += 1) {
      const result = await consumeRateLimit(keyA, policy, new Date());
      assert.equal(result.remaining, policy.limit - (i + 1));
    }
  });

  it("rejects the (limit+1)-th request with 429 RATE_LIMITED", async () => {
    await assert.rejects(
      () => consumeRateLimit(keyA, policy, new Date()),
      (error: unknown) =>
        error instanceof Object &&
        (error as { code?: string }).code === "RATE_LIMITED" &&
        (error as { status?: number }).status === 429,
    );
  });

  it("keeps identifiers isolated (one abuser does not exhaust another)", async () => {
    const result = await consumeRateLimit(keyB, policy, new Date());
    assert.equal(result.remaining, policy.limit - 1);
  });

  it("starts a fresh window after the window boundary passes", async () => {
    const nextWindow = new Date(Date.now() + policy.windowMs * 2);
    const result = await consumeRateLimit(keyA, policy, nextWindow);
    assert.equal(result.remaining, policy.limit - 1);
  });
});
