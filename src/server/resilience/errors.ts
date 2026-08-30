// Internal resilience failures. These are NEVER surfaced to clients directly —
// call sites (email port, payment provider) map them onto their own stable
// error semantics (e.g. EmailDeliveryError, providerFault ApiError).
export type ResilienceErrorCode = "TIMEOUT" | "CIRCUIT_OPEN";

export class ResilienceError extends Error {
  constructor(
    public readonly code: ResilienceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ResilienceError";
  }
}
