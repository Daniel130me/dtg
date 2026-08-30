import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { assertAllowedOrigin } from "@/server/http/cors";
import { assertStudentResourceOwner } from "@/server/auth/authorization";
import { resetServerEnvForTests } from "@/server/config/env";
import {
  BIO_MAX,
  NAME_MAX,
  updateAccountProfileSchema,
  deleteAccountSchema,
  changePasswordSchema,
} from "@/contracts/accounts";
import { ApiError } from "@/server/http/errors";
import { snapshotJson } from "@/server/observability/metrics";
import { getReleaseInfo } from "@/server/observability/release";

// Phase 12 security suite (pure slices): the CSRF origin gate, the BOLA
// resource-owner guard, mass-assignment rejection on the account contracts,
// payload-size limits, and secret hygiene in the observability payloads.
// Database-backed abuse behaviour (rate limiting) lives in
// tests/integration/rate-limit.test.ts; cross-user endpoint checks are covered
// by the owner-ops/learning suites.

const ORIGINAL_CORS = process.env.CORS_ORIGINS;

afterEach(() => {
  process.env.CORS_ORIGINS = ORIGINAL_CORS;
  resetServerEnvForTests();
});

function requestWithOrigin(origin: string | null): Request {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new Request("http://localhost:3000/api/v1/courses", { headers });
}

describe("CSRF origin gate (assertAllowedOrigin)", () => {
  it("allows non-browser requests without an Origin header (curl, server-to-server)", () => {
    process.env.CORS_ORIGINS = "http://localhost:3000";
    resetServerEnvForTests();
    assert.doesNotThrow(() => assertAllowedOrigin(requestWithOrigin(null)));
  });

  it("allows exactly the allowlisted origins", () => {
    process.env.CORS_ORIGINS = "https://dtg.example,https://admin.dtg.example";
    resetServerEnvForTests();
    assert.doesNotThrow(() => assertAllowedOrigin(requestWithOrigin("https://dtg.example")));
    assert.doesNotThrow(() => assertAllowedOrigin(requestWithOrigin("https://admin.dtg.example")));
  });

  it("rejects foreign origins with 403 ORIGIN_NOT_ALLOWED (cross-site form/fetch)", () => {
    process.env.CORS_ORIGINS = "http://localhost:3000";
    resetServerEnvForTests();
    assert.throws(
      () => assertAllowedOrigin(requestWithOrigin("https://evil.example")),
      (error: unknown) =>
        error instanceof ApiError && error.status === 403 && error.code === "ORIGIN_NOT_ALLOWED",
    );
  });

  it("treats lookalike origins (suffix/prefix) as foreign", () => {
    process.env.CORS_ORIGINS = "https://dtg.example";
    resetServerEnvForTests();
    assert.throws(
      () => assertAllowedOrigin(requestWithOrigin("https://evildtg.example")),
      (error: unknown) => error instanceof ApiError,
    );
    assert.throws(
      () => assertAllowedOrigin(requestWithOrigin("https://dtg.example.evil.io")),
      (error: unknown) => error instanceof ApiError,
    );
  });
});

describe("BOLA resource-owner guard", () => {
  it("accepts the owner of the resource", () => {
    assert.doesNotThrow(() => assertStudentResourceOwner("user-a", "user-a"));
  });

  it("rejects access to another user's resource with 403", () => {
    assert.throws(
      () => assertStudentResourceOwner("user-a", "user-b"),
      (error: unknown) => error instanceof ApiError && error.status === 403,
    );
  });
});

describe("mass-assignment rejection (strict account contracts)", () => {
  it("rejects a profile update that smuggles role/verification fields", () => {
    assert.throws(() =>
      updateAccountProfileSchema.parse({
        name: "Ada Lovelace",
        role: "OWNER",
        emailVerified: true,
      }),
    );
  });

  it("rejects unknown notification preference keys", () => {
    assert.throws(() =>
      updateAccountProfileSchema.parse({
        notificationPrefs: { emailNotifications: true, adminBroadcasts: true },
      }),
    );
  });

  it("rejects extra keys on the password change and deletion bodies", () => {
    assert.throws(() =>
      changePasswordSchema.parse({ currentPassword: "x", newPassword: "y", userId: "smuggled" }),
    );
    assert.throws(() =>
      deleteAccountSchema.parse({ confirmation: "DELETE", hard: true }),
    );
  });
});

describe("payload-size limits", () => {
  it("rejects a bio over BIO_MAX and a name over NAME_MAX", () => {
    assert.throws(() => updateAccountProfileSchema.parse({ bio: "x".repeat(BIO_MAX + 1) }));
    assert.throws(() => updateAccountProfileSchema.parse({ name: "x".repeat(NAME_MAX + 1) }));
  });

  it("accepts boundary-sized values", () => {
    const parsed = updateAccountProfileSchema.parse({
      bio: "x".repeat(BIO_MAX),
      name: "x".repeat(NAME_MAX),
    });
    assert.equal(parsed.bio?.length, BIO_MAX);
  });
});

describe("observability secret hygiene", () => {
  it("metrics snapshots never contain credential-shaped strings", () => {
    const snapshot = JSON.stringify(snapshotJson());
    assert.doesNotMatch(snapshot, /password|secret|salt|bearer|postgres:\/\//i);
  });

  it("release info exposes only release/env identity, never connection secrets", () => {
    const release = getReleaseInfo();
    const serialized = JSON.stringify(release);
    assert.doesNotMatch(serialized, /postgres:\/\//i);
    assert.ok(typeof release.releaseId === "string" && release.releaseId.length > 0);
    assert.ok(["development", "test", "production"].includes(release.environment));
  });
});
