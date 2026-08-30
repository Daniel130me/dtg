import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureError,
  flushErrorMonitorForTests,
  setErrorMonitorSinkForTests,
  type CapturedError,
} from "@/server/observability/error-monitor";

interface SinkCall {
  message: string;
  context: Record<string, unknown>;
}

/** Sink-collecting harness; also guarantees no test can hit the real logger. */
function makeSink(): { calls: SinkCall[]; sink: (message: string, context: Record<string, unknown>) => void } {
  const calls: SinkCall[] = [];
  return {
    calls,
    sink: (message, context) => {
      calls.push({ message, context });
    },
  };
}

describe("error monitor", () => {
  it("redacts sensitive keys in the capture context through the sink", () => {
    const { calls, sink } = makeSink();
    setErrorMonitorSinkForTests(sink);
    try {
      captureError(new Error("boom"), {
        requestId: "req-12345678",
        route: "GET /api/v1/example",
        userId: "user-1",
        extra: {
          token: "bearer-value",
          nested: {
            authorization: "Basic abc",
            cookie: "session=xyz",
            password: "hunter2",
            databaseUrl: "postgresql://user:pass@host/db",
            accessKey: "AKIA...",
            apiKey: "AKIA-not-covered-by-the-historical-pattern",
            safe: "kept",
          },
        },
      });

      assert.equal(calls.length, 1);
      const context = calls[0].context;
      assert.equal(calls[0].message, "Unhandled error");
      assert.equal(context.token, "[REDACTED]");
      const nested = context.nested as Record<string, unknown>;
      assert.equal(nested.authorization, "[REDACTED]");
      assert.equal(nested.cookie, "[REDACTED]");
      assert.equal(nested.password, "[REDACTED]");
      assert.equal(nested.databaseUrl, "[REDACTED]");
      // access.?key matches "accessKey"; bare "apiKey" is NOT covered by the
      // historical logger pattern (documented boundary, kept byte-compatible).
      assert.equal(nested.accessKey, "[REDACTED]");
      assert.equal(nested.apiKey, "AKIA-not-covered-by-the-historical-pattern");
      assert.equal(nested.safe, "kept");

      // The error itself is structured, never the raw throw.
      const error = context.error as { name: string; message: string; stack?: string };
      assert.equal(error.name, "Error");
      assert.equal(error.message, "boom");
      assert.match(context.fingerprint as string, /^[0-9a-f]{64}$/);
      assert.equal(context.count, 1);
      // Release enrichment is present.
      assert.ok(typeof context.releaseId === "string" && context.releaseId.length > 0);
      assert.ok(typeof context.environment === "string");
    } finally {
      flushErrorMonitorForTests();
    }
  });

  it("normalizes string and object throws", () => {
    const { calls, sink } = makeSink();
    setErrorMonitorSinkForTests(sink);
    try {
      const fromString = captureError("plain failure");
      assert.equal(fromString?.name, "string");
      assert.equal(fromString?.message, "plain failure");

      const fromObject = captureError({ code: "X", token: "leak-attempt" });
      assert.equal(fromObject?.name, "NonError");
      // Object is rendered through redaction: the token key cannot leak.
      assert.equal(fromObject?.message.includes("[REDACTED]"), true);
      assert.equal(fromObject?.message.includes("leak-attempt"), false);

      const stringEntry = calls.find((call) => (call.context.error as { message: string }).message === "plain failure");
      assert.ok(stringEntry);
      const objectError = calls.find((call) => (call.context.error as { name: string }).name === "NonError");
      assert.ok(objectError);
    } finally {
      flushErrorMonitorForTests();
    }
  });

  it("deduplicates by name+message fingerprint and counts occurrences", () => {
    const { calls, sink } = makeSink();
    setErrorMonitorSinkForTests(sink);
    try {
      const first = captureError(new Error("recurring"));
      const second = captureError(new Error("recurring"));
      const different = captureError(new Error("recurring with suffix"));

      assert.equal(first?.fingerprint, second?.fingerprint);
      assert.equal(first?.count, 1);
      assert.equal(second?.count, 2);
      assert.notEqual(first?.fingerprint, different?.fingerprint);

      // Two sink calls so far: count 1 (first) + count 2 (power of two).
      const recurringCalls = calls.filter((call) => (call.context.error as { message: string }).message === "recurring");
      assert.equal(recurringCalls.length, 2);
      assert.equal(recurringCalls[1].context.count, 2);

      // Count 3 is not a power of two: counted, but not logged again.
      captureError(new Error("recurring"));
      captureError(new Error("recurring")); // count 4 -> logged again
      const total = calls.filter((call) => (call.context.error as { message: string }).message === "recurring");
      assert.equal(total.length, 3);
      assert.equal(total[2].context.count, 4);
    } finally {
      flushErrorMonitorForTests();
    }
  });

  it("keeps a bounded LRU: an evicted fingerprint is treated as new", () => {
    const { sink } = makeSink();
    setErrorMonitorSinkForTests(sink);
    try {
      const evicted = captureError(new Error("first-error-should-evict"));
      // Fill the LRU beyond its 200-fingerprint bound.
      for (let i = 0; i < 250; i++) captureError(new Error(`bulk-error-${i}`));
      const again = captureError(new Error("first-error-should-evict"));
      assert.ok(evicted);
      assert.ok(again);
      assert.equal(again?.count, 1); // evicted -> counted from scratch
      assert.equal(evicted?.fingerprint, again?.fingerprint);
    } finally {
      flushErrorMonitorForTests();
    }
  });

  it("flushErrorMonitorForTests clears dedupe state", () => {
    const { sink } = makeSink();
    setErrorMonitorSinkForTests(sink);
    captureError(new Error("flush-me"));
    flushErrorMonitorForTests();
    const after = captureError(new Error("flush-me"));
    assert.equal(after?.count, 1);
    flushErrorMonitorForTests();
  });
});
