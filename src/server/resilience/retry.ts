export interface RetryOptions {
  /** Total attempts including the first one. Default 3 (1 try + 2 retries). */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Returns true for faults worth retrying. Default: never retry. */
  retryable?: (error: unknown) => boolean;
  /** Injected sleep so tests never really wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected randomness so FULL JITTER is deterministic in tests. */
  random?: () => number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 150;
const DEFAULT_MAX_DELAY_MS = 2000;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with FULL JITTER (AWS-style): each wait is
 * `random() * min(maxDelayMs, baseDelayMs * 2^attempt)` where `attempt` is the
 * 0-based failed attempt. Full jitter spreads concurrent callers across the
 * whole delay window, avoiding retry stampedes against a struggling provider.
 *
 * A non-retryable error (or exhausted attempts) rethrows the last error
 * immediately.
 */
export async function withRetries<T>(op: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const retryable = options.retryable ?? (() => false);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await op();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= attempts - 1;
      if (isLastAttempt || !retryable(error)) throw error;

      const ceilingMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(random() * ceilingMs);
    }
  }
  // Unreachable: the loop either returns or throws on its final attempt.
  throw lastError;
}
