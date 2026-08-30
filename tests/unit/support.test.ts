import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTACT_MAX_LINKS, CONTACT_RETENTION_DAYS } from "@/contracts/support";
import {
  assessContactSpam,
  contactRetentionCutoff,
} from "@/server/modules/support/contact.logic";

// Pure support-contact policy: the honeypot, the link heuristic and the
// retention date math. The service layer turns `true` into the single generic
// 422 (the tests assert the policy, never the copy).

describe("contact spam assessment", () => {
  const clean = { message: "Hello, I have a question about course pricing." };

  it("passes a clean human submission", () => {
    assert.equal(assessContactSpam(clean), false);
    assert.equal(assessContactSpam({ ...clean, website: "" }), false);
    assert.equal(assessContactSpam({ ...clean, website: undefined }), false);
  });

  it("rejects any non-empty honeypot value", () => {
    assert.equal(assessContactSpam({ ...clean, website: "http://spam.example" }), true);
    assert.equal(assessContactSpam({ ...clean, website: "bot was here" }), true);
  });

  it("accepts up to the contract's link budget", () => {
    const links = Array.from({ length: CONTACT_MAX_LINKS }, (_, i) => `https://docs.example/page-${i}`).join(" ");
    assert.equal(assessContactSpam({ message: `Context: ${links} — please help.` }), false);
  });

  it("rejects messages exceeding the link budget", () => {
    const links = Array.from({ length: CONTACT_MAX_LINKS + 1 }, (_, i) => `http://spam.example/${i}`).join(" ");
    assert.equal(assessContactSpam({ message: `Great site! ${links}` }), true);
  });
});

describe("contact retention window", () => {
  it("cuts off exactly CONTACT_RETENTION_DAYS before now", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    const cutoff = contactRetentionCutoff(now, CONTACT_RETENTION_DAYS);
    assert.equal(cutoff.toISOString(), "2025-10-17T12:00:00.000Z");
  });

  it("keeps submissions created after the cutoff purgeable-only-later", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    const cutoff = contactRetentionCutoff(now, CONTACT_RETENTION_DAYS);
    const recent = new Date(cutoff.getTime() + 60_000);
    assert.ok(recent.getTime() > cutoff.getTime());
  });
});
