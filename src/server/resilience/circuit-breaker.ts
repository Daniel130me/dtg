import { ResilienceError } from "@/server/resilience/errors";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures (default 5) before the circuit trips open. */
  failureThreshold?: number;
  /** How long the circuit stays open before allowing one trial request. */
  resetTimeoutMs?: number;
  /** Injectable clock (ms) for deterministic tests. */
  clock?: () => number;
  /**
   * Decides whether a thrown error counts as a failure. Default: every throw.
   * Used by the email port so permanent errors (bad config, hard bounces)
   * never trip the breaker — they would fail again regardless of the circuit.
   */
  failurePredicate?: (error: unknown) => boolean;
}

export interface CircuitBreakerSnapshot {
  state: CircuitState;
  failures: number;
  openedAtMs: number | null;
}

/**
 * Classic three-state circuit breaker.
 *
 * closed    -> run op, record success/failure; trip open at the threshold.
 * open      -> fail fast with ResilienceError("CIRCUIT_OPEN"); after
 *              resetTimeoutMs the next call becomes a half-open trial.
 * half-open -> exactly one trial request runs; success closes the circuit,
 *              failure re-opens it with a fresh reset timeout.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAtMs: number | null = null;
  private trialInFlight = false;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly clock: () => number;
  private readonly failurePredicate: (error: unknown) => boolean;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.clock = options.clock ?? Date.now;
    this.failurePredicate = options.failurePredicate ?? (() => true);
  }

  async execute<T>(op: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      const elapsed = this.clock() - (this.openedAtMs ?? 0);
      if (elapsed >= this.resetTimeoutMs) {
        // Cool-down elapsed: allow exactly one trial request.
        this.state = "half-open";
      } else {
        throw new ResilienceError("CIRCUIT_OPEN", "Circuit breaker is open.");
      }
    }

    if (this.state === "half-open") {
      if (this.trialInFlight) {
        // Only one probe may run while half-open; everyone else fails fast.
        throw new ResilienceError("CIRCUIT_OPEN", "Circuit breaker is half-open with a trial in flight.");
      }
      this.trialInFlight = true;
      try {
        const result = await op();
        this.recordSuccess();
        return result;
      } catch (error) {
        if (this.failurePredicate(error)) this.trip();
        throw error;
      } finally {
        this.trialInFlight = false;
      }
    }

    try {
      const result = await op();
      this.recordSuccess();
      return result;
    } catch (error) {
      if (this.failurePredicate(error)) {
        this.failures += 1;
        if (this.failures >= this.failureThreshold) this.trip();
      }
      throw error;
    }
  }

  snapshot(): CircuitBreakerSnapshot {
    return { state: this.state, failures: this.failures, openedAtMs: this.openedAtMs };
  }

  private recordSuccess(): void {
    this.state = "closed";
    this.failures = 0;
    this.openedAtMs = null;
  }

  private trip(): void {
    this.state = "open";
    this.openedAtMs = this.clock();
  }
}
