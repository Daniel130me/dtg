import { ApiError } from "@/server/http/errors";
import { getServerEnv } from "@/server/config/env";
import { createFlutterwaveProvider } from "@/server/modules/payments/flutterwave.provider";

// ---------------------------------------------------------------------------
// Provider-neutral payment boundary (Phase 7)
//
// The rest of the platform codes against this interface so the concrete
// provider (Flutterwave) stays an isolated detail. Without both Flutterwave
// env values configured, getConfiguredPaymentProvider returns null and paid
// checkout fails closed with PAYMENT_PROVIDER_NOT_CONFIGURED before any order
// row is written.
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
  /**
   * Absolute URL the provider redirects back to after payment. Callers must
   * resolve it against APP_URL — hosted providers reject relative paths.
   */
  successUrl: string;
  cancelUrl: string;
  /** Payer identity forwarded to the hosted checkout page. */
  customer: { email: string; name: string };
}

export interface CheckoutSession {
  provider: string;
  /** Provider-side reference stored for idempotent webhook reconciliation. */
  providerRef: string;
  /** Hosted payment page URL, or null for providers that render in-app. */
  checkoutUrl: string | null;
}

/** Server-owned result of re-verifying a provider transaction via its API. */
export interface VerifiedTransaction {
  providerRef: string;
  status: "SUCCESSFUL" | "FAILED";
  amountMinor: number;
  currency: string;
  /** The local reference (tx_ref) the provider echoed back. */
  localRef: string;
}

export interface RefundResult {
  providerRef: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
}

export interface PaymentProvider {
  readonly name: string;
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Re-checks a transaction against the provider API (verify-then-fulfil). */
  verifyTransaction(providerTransactionId: string): Promise<VerifiedTransaction>;
  /** Requests a refund; a null amountMinor means "refund the full amount". */
  refundTransaction(
    providerTransactionId: string,
    amountMinor: number | null,
    currency: string,
  ): Promise<RefundResult>;
}

/**
 * Returns the configured launch provider, or null while payments are disabled.
 * Both Flutterwave values must be present: a secret key without the webhook
 * hash (or the reverse) would leave half the integration broken.
 */
export function getConfiguredPaymentProvider(): PaymentProvider | null {
  const env = getServerEnv();
  if (!env.FLUTTERWAVE_SECRET_KEY || !env.FLUTTERWAVE_WEBHOOK_HASH) return null;
  return createFlutterwaveProvider();
}

/** Stable client-matchable fail-closed state (used by checkout + webhooks). */
export const PAYMENT_PROVIDER_NOT_CONFIGURED_CODE = "PAYMENT_PROVIDER_NOT_CONFIGURED";
export const PAYMENT_PROVIDER_NOT_CONFIGURED_MESSAGE =
  "Paid enrolment is not available yet. Free courses can be enrolled in directly.";

/** Fails closed with a stable client-matchable code when payments are off. */
export function requirePaymentProvider(): PaymentProvider {
  const provider = getConfiguredPaymentProvider();
  if (!provider) {
    throw new ApiError(
      503,
      PAYMENT_PROVIDER_NOT_CONFIGURED_CODE,
      PAYMENT_PROVIDER_NOT_CONFIGURED_MESSAGE,
    );
  }
  return provider;
}
