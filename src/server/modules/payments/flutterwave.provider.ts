import { getServerEnv } from "@/server/config/env";
import { ApiError } from "@/server/http/errors";
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
    throw providerFault();
  }

  if (!response.ok) throw providerFault();

  const envelope = (await response.json().catch(() => null)) as FlutterwaveEnvelope<T> | null;
  // Flutterwave wraps every response in { status: "success", data: ... }.
  if (!envelope || envelope.status !== "success") throw providerFault();
  return envelope.data;
}

export function createFlutterwaveProvider(): PaymentProvider {
  return {
    name: FLUTTERWAVE_PROVIDER_NAME,

    async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
      const totalMinor = request.items.reduce((sum, item) => sum + item.unitPriceMinor, 0);
      const data = await flutterwaveRequest<{ link: string }>("/payments", {
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
      });
      return {
        provider: FLUTTERWAVE_PROVIDER_NAME,
        providerRef: request.orderId,
        checkoutUrl: data.link,
      };
    },

    async verifyTransaction(providerTransactionId: string): Promise<VerifiedTransaction> {
      const data = await flutterwaveRequest<{
        status: string;
        amount: number;
        currency: string;
        tx_ref: string;
      }>(`/transactions/${encodeURIComponent(providerTransactionId)}/verify`, { method: "GET" });
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
      const data = await flutterwaveRequest<{ id: number; status: string }>(
        `/transactions/${encodeURIComponent(providerTransactionId)}/refund`,
        {
          method: "POST",
          // Omitting the amount asks Flutterwave for a full refund.
          body: amountMinor === null ? {} : { amount: minorToMajorUnits(amountMinor) },
        },
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
