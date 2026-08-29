import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequestContext } from "@/server/http/request-context";

describe("request context", () => {
  it("preserves a safe caller request id", () => {
    const request = new Request("https://dtg.test", { headers: { "x-request-id": "request_12345678" } });
    assert.equal(createRequestContext(request).requestId, "request_12345678");
  });

  it("replaces an unsafe request id", () => {
    const request = new Request("https://dtg.test", { headers: { "x-request-id": "<script>" } });
    assert.match(createRequestContext(request).requestId, /^[0-9a-f-]{36}$/);
  });
});
