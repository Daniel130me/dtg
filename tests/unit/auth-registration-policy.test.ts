import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isReservedOwnerEmail,
  normalizeRegistrationEmail,
} from "@/server/auth/registration-policy";

describe("student registration owner-email policy", () => {
  it("normalizes casing and surrounding whitespace consistently", () => {
    assert.equal(normalizeRegistrationEmail("  Owner@Example.COM "), "owner@example.com");
  });

  it("reserves the configured owner address case-insensitively", () => {
    assert.equal(
      isReservedOwnerEmail(" OWNER@example.com ", "owner@EXAMPLE.com"),
      true,
    );
  });

  it("allows unrelated students and degrades safely when no owner is configured", () => {
    assert.equal(isReservedOwnerEmail("student@example.com", "owner@example.com"), false);
    assert.equal(isReservedOwnerEmail("student@example.com"), false);
  });
});
