import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertStudentResourceOwner } from "@/server/auth/authorization";
import { isSensitiveAuthRequest, progressiveCooldownSeconds } from "@/server/auth/auth-rate-limit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { safeRedirectPath } from "@/lib/client/safe-redirect";

describe("authentication security", () => {
  it("hashes passwords with Argon2id and verifies without storing plaintext", async () => {
    const password = "a-correct-horse-battery-staple";
    const hashed = await hashPassword(password);

    assert.match(hashed, /^\$argon2id\$/);
    assert.notEqual(hashed, password);
    assert.equal(await verifyPassword({ hash: hashed, password }), true);
    assert.equal(await verifyPassword({ hash: hashed, password: "wrong-password" }), false);
  });

  it("rate limits credential, recovery, and verification mutations", () => {
    for (const action of ["sign-in", "sign-up", "request-password-reset", "reset-password", "send-verification-email"]) {
      assert.equal(isSensitiveAuthRequest("POST", `/api/auth/${action}`), true);
    }
    assert.equal(isSensitiveAuthRequest("GET", "/api/auth/get-session"), false);
    assert.deepEqual(
      [5, 6, 8, 10].map(progressiveCooldownSeconds),
      [0, 30, 120, 900],
    );
  });

  it("rejects access to another student's resource", () => {
    assert.doesNotThrow(() => assertStudentResourceOwner("student-1", "student-1"));
    assert.throws(() => assertStudentResourceOwner("student-1", "student-2"), /cannot access/i);
  });

  it("allows only local redirect paths", () => {
    assert.equal(safeRedirectPath("/learning/course-1?lesson=2"), "/learning/course-1?lesson=2");
    assert.equal(safeRedirectPath("https://attacker.example/steal"), "/dashboard");
    assert.equal(safeRedirectPath("//attacker.example/steal"), "/dashboard");
  });
});
