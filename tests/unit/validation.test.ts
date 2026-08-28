import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { parseJsonBody } from "@/server/http/validation";

const schema = z.object({ name: z.string().min(2) });

describe("JSON request validation", () => {
  it("parses a valid JSON request", async () => {
    const request = new Request("https://dtg.test/api/v1/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "DTG" }),
    });

    assert.deepEqual(await parseJsonBody(request, schema), { name: "DTG" });
  });

  it("rejects unsupported content types", async () => {
    const request = new Request("https://dtg.test/api/v1/example", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "DTG",
    });

    await assert.rejects(parseJsonBody(request, schema), { status: 415 });
  });

  it("enforces the actual byte limit when content-length is absent", async () => {
    const request = new Request("https://dtg.test/api/v1/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "a".repeat(100) }),
    });

    await assert.rejects(parseJsonBody(request, schema, 32), { status: 413 });
  });
});
