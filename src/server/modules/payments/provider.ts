import { ApiError } from "@/server/http/errors";

// ---------------------------------------------------------------------------
// Provider-neutral payment boundary (Phase 7)
//
// Paid checkout depends on a launch provider, which is a deliberate business
// decision that has not been made yet. The rest of the platform codes against
// this interface so adopting a provider is an isolated change: implement the
// interface and return it from getConfiguredPaymentProvider. Until then paid
// checkout fails closed with PAYMENT_PROVIDER_NOT_CONFIGURED and no order
// rows are written.
// ---------------------------------------------------------------------------

/** One course line in a checkout request; prices are server-owned snapshots. */
export interface CheckoutLineItem {
  courseId: string;
  title: string;
  unitPriceMinor: number;
  currency: string;
}

export interface CheckoutRequest {
  userId: string;
  /** Local order id the provider session must reconcile back to. */
  orderId: string;
  items: CheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  provider: string;
  /** Provider-side reference stored for idempotent webhook reconciliation. */
  providerRef: string;
  /** Hosted payment page URL, or null for providers that render in-app. */
  checkoutUrl: string | null;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>;
}

/**
 * Returns the configured launch provider, or null while payments are disabled.
 * Wiring an env flag here is intentional deferred work: it belongs to the
 * milestone that introduces the concrete provider implementation.
 */
export function getConfiguredPaymentProvider(): PaymentProvider | null {
  return null;
}

/** Fails closed with a stable client-matchable code when payments are off. */
export function requirePaymentProvider(): PaymentProvider {
  const provider = getConfiguredPaymentProvider();
  if (!provider) {
    throw new ApiError(
      503,
      "PAYMENT_PROVIDER_NOT_CONFIGURED",
      "Paid enrolment is not available yet. Free courses can be enrolled in directly.",
    );
  }
  return provider;
}
