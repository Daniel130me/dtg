import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiClientError, apiRequest } from "@/lib/client/api-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("API client response handling", () => {
  it("returns data from a valid JSON success envelope", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { lessonId: "lesson-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    assert.deepEqual(await apiRequest<{ lessonId: string }>("/api/example"), {
      lessonId: "lesson-1",
    });
  });

  it("turns an HTML framework response into a stable client error", async () => {
    globalThis.fetch = async () =>
      new Response("<!DOCTYPE html><html><body>Not found</body></html>", {
        status: 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-request-id": "request-123",
        },
      });

    await assert.rejects(
      apiRequest("/api/missing"),
      (error: unknown) =>
        error instanceof ApiClientError &&
        error.status === 404 &&
        error.code === "UNEXPECTED_RESPONSE" &&
        error.requestId === "request-123" &&
        !error.message.includes("DOCTYPE"),
    );
  });

  it("handles malformed and incomplete JSON without leaking parser errors", async () => {
    globalThis.fetch = async () =>
      new Response("{not-json", {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(
      apiRequest("/api/broken"),
      (error: unknown) =>
        error instanceof ApiClientError && error.code === "UNEXPECTED_RESPONSE",
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ meta: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(
      apiRequest("/api/incomplete"),
      (error: unknown) =>
        error instanceof ApiClientError && error.message.includes("incomplete"),
    );
  });
});
