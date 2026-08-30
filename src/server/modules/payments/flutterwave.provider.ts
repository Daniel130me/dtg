import { getServerEnv } from "@/server/config/env";
import { ApiError } from "@/server/http/errors";
import { withSpan } from "@/server/observability/trace";
import { recordPaymentApiCall } from "@/server/observability/metrics";
import {
  FLUTTERWAVE_API_BASE_URL,
  FLUTTERWAVE_CHECKOUT_TITLE,
  FLUTTERWAVE_PROVIDER_ERROR,
  FLUTTERWAVE_PROVIDER_NAME,
  FLUTTERWAVE_REQUEST_TIMEOUT_MS,
  majorToMinorUnits,
  minorToMajorUnits,
} from "@/server/modules/payments/flutterwave.logic";
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  RefundResult,
  VerifiedTransaction,
} from "@/server/modules/payments/provider";
import { CircuitBreaker } from "@/server/resilience/circuit-breaker";
import { withRetries } from "@/server/resilience/retry";

// ---------------------------------------------------------------------------
// Flutterwave provider (Phase 7 launch provider).
//
// Webhook authenticity is verify-then-fulfil: the verif-hash header only gates
// delivery, and fulfilment never trusts the webhook payload alone — the server
// always re-verifies the transaction through the authenticated verify API
// (Flutterwave's own recommendation) before crediting an order. A leaked
// webhook hash can therefore never credit an order by itself.
//
// Money: minor units in, minor units out; conversion to Flutterwave's 2-decimal
// major units happens here and only here (see flutterwave.logic.ts).
//
// Resilience (Phase 12): every provider call is retried up to twice for
// network faults / HTTP 5xx / 429 with full-jitter backoff, guarded by a
// provider-wide circuit breaker (8 failures, 60s reset), timed (the fetch
// carries AbortSignal.timeout(FLUTTERWAVE_REQUEST_TIMEOUT_MS) = 10s — the
// signal already bounds the whole request INCLUDING the body read, so no
// second timeout layer is stacked on top), and observed via spans +
// payment_api_calls_total. Client semantics are untouched: every
// transport/HTTP/shape fault still maps to the same 502 providerFault.
// ---------------------------------------------------------------------------

/** Maps every transport/HTTP/shape fault to one stable 502 code: provider
 * internals (auth failures, raw error bodies) never leak to clients. */
function providerFault(): ApiError {
  return new ApiError(
    502,
    FLUTTERWAVE_PROVIDER_ERROR,
    "The payment provider rejected the request. Please try again.",
  );
}

/** Internal fault classification so the retry layer can distinguish network
 * faults and 5xx/429 responses. Never escapes this module: mapped to the
 * stable 502 providerFault before reaching callers. */
class FlutterwaveTransportError extends Error {
  constructor(
    readonly kind: "network" | "http",
    readonly httpStatus?: number,
  ) {
    super(kind === "network" ? "Flutterwave request failed at network level." : `Flutterwave responded ${httpStatus}.`);
    this.name = "FlutterwaveTransportError";
  }
}

interface FlutterwaveEnvelope<T> {
  status: string;
  data: T;
}

async function flutterwaveRequest<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const secretKey = getServerEnv().FLUTTERWAVE_SECRET_KEY;
  let response: Response;
  try {
    response = await fetch(`${FLUTTERWAVE_API_BASE_URL}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(FLUTTERWAVE_REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Network/timeout faults share the same mapped error as HTTP failures.
    throw new FlutterwaveTransportError("network");
  }

  if (!response.ok) throw new FlutterwaveTransportError("http", response.status);

  const envelope = (await response.json().catch(() => null)) as FlutterwaveEnvelope<T> | null;
  // Flutterwave wraps every response in { status: "success", data: ... }.
  if (!envelope || envelope.status !== "success") throw providerFault();
  return envelope.data;
}

const PAYMENT_BREAKER_FAILURE_THRESHOLD = 8;
const PAYMENT_BREAKER_RESET_TIMEOUT_MS = 60_000;
const PAYMENT_RETRY_ATTEMPTS = 3; // 1 try + 2 retries max
const PAYMENT_RETRY_BASE_DELAY_MS = 150;
const PAYMENT_RETRY_MAX_DELAY_MS = 2_000;

const paymentCircuitBreaker = new CircuitBreaker({
  failureThreshold: PAYMENT_BREAKER_FAILURE_THRESHOLD,
  resetTimeoutMs: PAYMENT_BREAKER_RESET_TIMEOUT_MS,
});

function isRetryableFlutterwaveFault(error: unknown): boolean {
  if (!(error instanceof FlutterwaveTransportError)) return false;
  return error.kind === "network" || error.httpStatus === 429 || (error.httpStatus ?? 0) >= 500;
}

/**
 * One provider call: retry layer -> circuit breaker -> request, wrapped in a
 * span (outcome only — no provider refs or payloads in logs) and counted via
 * payment_api_calls_total. All failure modes still collapse to the stable 502
 * providerFault an OPEN breaker included, so webhook deliveries keep failing
 * over to Flutterwave's retry queue exactly as before.
 */
async function flutterwaveCall<T>(spanName: string, request: () => Promise<T>): Promise<T> {
  // The span attrs object is spread at log time, so setting `outcome` inside
  // the closure makes the span line carry the call's outcome.
  const spanAttrs: Record<string, unknown> = {};
  try {
    const result = await withSpan(spanName, spanAttrs, async () => {
      try {
        const value = await paymentCircuitBreaker.execute(() =>
          withRetries(request, {
            attempts: PAYMENT_RETRY_ATTEMPTS,
            baseDelayMs: PAYMENT_RETRY_BASE_DELAY_MS,
            maxDelayMs: PAYMENT_RETRY_MAX_DELAY_MS,
            retryable: isRetryableFlutterwaveFault,
          }),
        );
        // Set inside the span closure so the ok-line carries the outcome.
        spanAttrs.outcome = "ok";
        return value;
      } catch (error) {
        spanAttrs.outcome = "error";
        throw error;
      }
    });
    recordPaymentApiCall("ok");
    return result;
  } catch (error) {
    recordPaymentApiCall("error");
    if (error instanceof FlutterwaveTransportError) throw providerFault();
    if (error instanceof ApiError) throw error;
    // ResilienceError (CIRCUIT_OPEN) or anything unexpected -> stable 502.
    throw providerFault();
  }
}

export function createFlutterwaveProvider(): PaymentProvider {
  return {
    name: FLUTTERWAVE_PROVIDER_NAME,

    async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
      const totalMinor = request.items.reduce((sum, item) => sum + item.unitPriceMinor, 0);
      const data = await flutterwaveCall("payment.create_checkout", () =>
        flutterwaveRequest<{ link: string }>("/payments", {
          method: "POST",
          body: {
            // tx_ref is our local order id, so every provider event reconciles
            // back to the order without an extra lookup table.
            tx_ref: request.orderId,
            amount: minorToMajorUnits(totalMinor),
            currency: request.items[0].currency,
            redirect_url: request.successUrl,
            customer: request.customer,
            customizations: { title: FLUTTERWAVE_CHECKOUT_TITLE },
            meta: { orderId: request.orderId },
          },
        }),
      );
      return {
        provider: FLUTTERWAVE_PROVIDER_NAME,
        providerRef: request.orderId,
        checkoutUrl: data.link,
      };
    },

    async verifyTransaction(providerTransactionId: string): Promise<VerifiedTransaction> {
      const data = await flutterwaveCall("payment.verify", () =>
        flutterwaveRequest<{
          status: string;
          amount: number;
          currency: string;
          tx_ref: string;
        }>(`/transactions/${encodeURIComponent(providerTransactionId)}/verify`, { method: "GET" }),
      );
      return {
        providerRef: providerTransactionId,
        // Anything other than an explicit "successful" is treated as not paid.
        status: data.status === "successful" ? "SUCCESSFUL" : "FAILED",
        amountMinor: majorToMinorUnits(data.amount),
        currency: data.currency,
        localRef: data.tx_ref,
      };
    },

    async refundTransaction(
      providerTransactionId: string,
      amountMinor: number | null,
      currency: string,
    ): Promise<RefundResult> {
      void currency; // Flutterwave infers the currency from the transaction.
      const data = await flutterwaveCall("payment.refund", () =>
        flutterwaveRequest<{ id: number; status: string }>(
          `/transactions/${encodeURIComponent(providerTransactionId)}/refund`,
          {
            method: "POST",
            // Omitting the amount asks Flutterwave for a full refund.
            body: amountMinor === null ? {} : { amount: minorToMajorUnits(amountMinor) },
          },
        ),
      );
      return {
        providerRef: String(data.id),
        // Refunds are asynchronous: only an explicitly terminal provider status
        // is trusted, anything else stays PENDING until refund.completed lands.
        status: data.status === "completed" || data.status === "successful"
          ? "SUCCEEDED"
          : data.status === "failed"
            ? "FAILED"
            : "PENDING",
      };
    },
  };
}
