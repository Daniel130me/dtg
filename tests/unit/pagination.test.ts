import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";

describe("cursor pagination", () => {
  it("round-trips a stable cursor", () => {
    const cursor = {
      createdAt: "2026-08-28T12:30:00.000Z",
      id: "5f00ed84-39e2-4ac7-b09b-7218c8ebd22c",
    };

    assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  });

  it("rejects malformed cursors without leaking parser errors", () => {
    assert.throws(
      () => decodeCursor("not-a-cursor"),
      (error: unknown) => error instanceof ApiError && error.status === 422 && error.code === "INVALID_CURSOR",
    );
  });
});
