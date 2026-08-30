import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CircuitBreaker } from "@/server/resilience/circuit-breaker";
import { ResilienceError } from "@/server/resilience/errors";
import { withRetries } from "@/server/resilience/retry";
import { withTimeout } from "@/server/resilience/timeout";

const never: () => Promise<never> = () => new Promise(() => {});

describe("withTimeout", () => {
  it("resolves when the operation settles in time", async () => {
    const result = await withTimeout(50, "fast.op", async () => "value");
    assert.equal(result, "value");
  });

  it("rejects with a TIMEOUT resilience error when the operation hangs", async () => {
    const startedAt = Date.now();
    await assert.rejects(
      withTimeout(5, "stuck.op", never),
      (error: unknown) => {
        assert.ok(error instanceof ResilienceError);
        assert.equal(error.code, "TIMEOUT");
        assert.match(error.message, /stuck\.op timed out after 5ms/);
        return true;
      },
    );
    // The race must actually short-circuit, not wait for the stuck op.
    assert.ok(Date.now() - startedAt < 1_000);
  });
});

describe("withRetries", () => {
  it("returns without sleeping when the first attempt succeeds", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRetries(
      async () => {
        calls += 1;
        return "ok";
      },
      { sleep: async (ms) => void sleeps.push(ms) },
    );
    assert.equal(result, "ok");
    assert.equal(calls, 1);
    assert.deepEqual(sleeps, []);
  });

  it("retries only when the predicate says so and rethrows otherwise", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await assert.rejects(
      withRetries(
        async () => {
          calls += 1;
          throw new Error("permanent");
        },
        { attempts: 3, retryable: () => true, sleep: async (ms) => void sleeps.push(ms) },
      ),
      /permanent/,
    );
    // Non-retryable via predicate:
    let strictCalls = 0;
    await assert.rejects(
      withRetries(
        async () => {
          strictCalls += 1;
          throw new Error("no-retry");
        },
        { attempts: 3, retryable: () => false, sleep: async (ms) => void sleeps.push(ms) },
      ),
      /no-retry/,
    );
    assert.equal(strictCalls, 1);
    assert.equal(calls, 3);
    assert.equal(sleeps.length, 2); // one wait before each of retries 2 and 3
  });

  it("gives up after the configured attempts and throws the last error", async () => {
    let calls = 0;
    await assert.rejects(
      withRetries(
        async () => {
          calls += 1;
          throw new Error(`failure ${calls}`);
        },
        { attempts: 3, retryable: () => true, sleep: async () => {} },
      ),
      /failure 3/,
    );
    assert.equal(calls, 3);
  });

  it("applies FULL JITTER bounded by min(maxDelayMs, baseDelayMs * 2^attempt)", async () => {
    const ceilings: number[] = [];
    const recordCeilings = async (ms: number) => {
      ceilings.push(ms);
    };

    // random() === 1 -> delay equals the full ceiling each attempt
    // (6 attempts = 5 sleeps: ceilings 150, 300, 600, 1200, then capped 2000).
    ceilings.length = 0;
    await withRetries(
      async () => {
        throw new Error("x");
      },
      { attempts: 6, baseDelayMs: 150, maxDelayMs: 2000, retryable: () => true, random: () => 1, sleep: recordCeilings },
    ).catch(() => undefined);
    assert.deepEqual(ceilings, [150, 300, 600, 1200, 2000]);

    // random() === 0 -> zero delay (full jitter spans [0, ceiling)).
    ceilings.length = 0;
    await withRetries(
      async () => {
        throw new Error("x");
      },
      { attempts: 3, baseDelayMs: 150, maxDelayMs: 2000, retryable: () => true, random: () => 0, sleep: recordCeilings },
    ).catch(() => undefined);
    assert.deepEqual(ceilings, [0, 0]);

    // random() === 0.5 -> half the ceiling.
    ceilings.length = 0;
    await withRetries(
      async () => {
        throw new Error("x");
      },
      { attempts: 2, baseDelayMs: 150, maxDelayMs: 2000, retryable: () => true, random: () => 0.5, sleep: recordCeilings },
    ).catch(() => undefined);
    assert.deepEqual(ceilings, [75]);
  });

  it("succeeds when a retryable fault recovers", async () => {
    let calls = 0;
    const result = await withRetries(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        return "recovered";
      },
      { attempts: 3, retryable: () => true, sleep: async () => {} },
    );
    assert.equal(result, "recovered");
    assert.equal(calls, 2);
  });
});

describe("CircuitBreaker", () => {
  interface BreakerHarness {
    breaker: CircuitBreaker;
    now: () => number;
    advance: (ms: number) => void;
  }

  function makeBreaker(options: { failureThreshold?: number; resetTimeoutMs?: number } = {}): BreakerHarness {
    let current = 1_000;
    const breaker = new CircuitBreaker({
      failureThreshold: options.failureThreshold ?? 3,
      resetTimeoutMs: options.resetTimeoutMs ?? 10_000,
      clock: () => current,
    });
    return {
      breaker,
      now: () => current,
      advance: (ms) => {
        current += ms;
      },
    };
  }

  it("stays closed while successes interleave with failures", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 5; i++) {
      await breaker.execute(async () => "ok").catch(() => undefined);
      await breaker.execute(async () => {
        throw new Error("boom");
      }).catch(() => undefined);
    }
    assert.deepEqual(breaker.snapshot(), { state: "closed", failures: 1, openedAtMs: null });
  });

  it("opens after the consecutive failure threshold", async () => {
    const { breaker, now } = makeBreaker({ failureThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      await breaker.execute(async () => {
        throw new Error("boom");
      }).catch(() => undefined);
    }
    assert.deepEqual(breaker.snapshot(), { state: "open", failures: 3, openedAtMs: now() });
  });

  it("fails fast while open without invoking the operation", async () => {
    const { breaker } = makeBreaker({ failureThreshold: 1 });
    await breaker.execute(async () => {
      throw new Error("boom");
    }).catch(() => undefined);

    let calls = 0;
    await assert.rejects(
      breaker.execute(async () => {
        calls += 1;
        return "should not run";
      }),
      (error: unknown) => {
        assert.ok(error instanceof ResilienceError);
        assert.equal(error.code, "CIRCUIT_OPEN");
        return true;
      },
    );
    assert.equal(calls, 0);
  });

  it("allows exactly one half-open trial after the reset timeout", async () => {
    const { breaker, advance } = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 10_000 });
    await breaker.execute(async () => {
      throw new Error("boom");
    }).catch(() => undefined);
    advance(10_000); // cool-down elapsed

    let trialCalls = 0;
    const slowTrial = breaker.execute(async () => {
      trialCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "trial";
    });
    // While the trial is in flight, concurrent calls fail fast (CIRCUIT_OPEN).
    await assert.rejects(
      breaker.execute(async () => "concurrent"),
      (error: unknown) => {
        assert.ok(error instanceof ResilienceError);
        assert.equal(error.code, "CIRCUIT_OPEN");
        return true;
      },
    );
    assert.equal(await slowTrial, "trial");
    assert.equal(trialCalls, 1);
    assert.deepEqual(breaker.snapshot(), { state: "closed", failures: 0, openedAtMs: null });
  });

  it("closes again after a successful half-open trial", async () => {
    const { breaker, advance } = makeBreaker({ failureThreshold: 2, resetTimeoutMs: 5_000 });
    for (let i = 0; i < 2; i++) {
      await breaker.execute(async () => {
        throw new Error("boom");
      }).catch(() => undefined);
    }
    advance(5_000);
    assert.equal(await breaker.execute(async () => "recovered"), "recovered");
    assert.deepEqual(breaker.snapshot(), { state: "closed", failures: 0, openedAtMs: null });
  });

  it("re-opens with a fresh reset timeout when the half-open trial fails", async () => {
    const { breaker, advance, now } = makeBreaker({ failureThreshold: 1, resetTimeoutMs: 5_000 });
    await breaker.execute(async () => {
      throw new Error("boom");
    }).catch(() => undefined);
    const firstOpenedAtMs = now();
    advance(5_000);

    await breaker.execute(async () => {
      throw new Error("still down");
    }).catch(() => undefined);

    const snapshot = breaker.snapshot();
    assert.equal(snapshot.state, "open");
    assert.equal(snapshot.openedAtMs, firstOpenedAtMs + 5_000);
  });

  it("does not count failures excluded by the failure predicate", async () => {
    let current = 500;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      clock: () => current,
      failurePredicate: (error) => !(error instanceof TypeError), // e.g. permanent errors don't count
    });
    for (let i = 0; i < 5; i++) {
      await breaker.execute(async () => {
        throw new TypeError("permanent");
      }).catch(() => undefined);
    }
    assert.equal(breaker.snapshot().state, "closed");
    await breaker.execute(async () => {
      throw new Error("transient");
    }).catch(() => undefined);
    await breaker.execute(async () => {
      throw new Error("transient");
    }).catch(() => undefined);
    assert.equal(breaker.snapshot().state, "open");
  });
});
