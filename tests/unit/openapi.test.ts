import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openApiDocument } from "@/server/http/openapi";

describe("OpenAPI contract", () => {
  it("documents every foundation health endpoint under v1", () => {
    assert.equal(openApiDocument.openapi, "3.1.0");
    assert.ok(openApiDocument.paths["/health/live"]);
    assert.ok(openApiDocument.paths["/health/ready"]);
    assert.deepEqual(openApiDocument.servers, [{ url: "/api/v1" }]);
  });
});
