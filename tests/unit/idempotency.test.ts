import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashIdempotentRequest } from "@/server/http/idempotency";

describe("idempotent request hashing", () => {
  it("is stable when object key order changes", () => {
    assert.equal(
      hashIdempotentRequest({ courseId: "one", quantity: 1 }),
      hashIdempotentRequest({ quantity: 1, courseId: "one" }),
    );
  });

  it("changes when request content changes", () => {
    assert.notEqual(hashIdempotentRequest({ quantity: 1 }), hashIdempotentRequest({ quantity: 2 }));
  });
});
