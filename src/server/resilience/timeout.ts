import { ResilienceError } from "@/server/resilience/errors";

/**
 * Races `op` against a hard timer. If the operation has not settled within
 * `ms`, the returned promise rejects with ResilienceError("TIMEOUT") and the
 * timer is always cleared (no dangling handle keeps the event loop alive).
 *
 * Note: the underlying operation is not cancellable — it keeps running and its
 * eventual settlement is simply ignored, so only wrap idempotent-ish or
 * fire-and-forget-safe operations.
 */
export async function withTimeout<T>(ms: number, label: string, op: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      op(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ResilienceError("TIMEOUT", `${label} timed out after ${ms}ms.`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
