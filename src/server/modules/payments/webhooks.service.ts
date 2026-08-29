import { createHash } from "node:crypto";
import { z } from "zod";
import {
  PaymentStatus,
  Prisma,
  WebhookEventStatus,
} from "@prisma/client";
import {
  PAYMENT_AMOUNT_MISMATCH,
  PAYMENT_CURRENCY_MISMATCH,
  PAYMENT_NOT_FOUND,
  PAYMENT_ORDER_MISMATCH,
  PAYMENT_WEBHOOK_SIGNATURE_INVALID,
} from "@/contracts/payments";
import { db } from "@/server/db/client";
import type { TransactionClient } from "@/server/db/transaction";
import { withTransaction } from "@/server/db/transaction";
import { getServerEnv } from "@/server/config/env";
import { ApiError } from "@/server/http/errors";
import { fulfilPaidOrder } from "@/server/modules/payments/fulfilment.service";
import {
  buildWebhookEventRef,
  classifyChargeEventStatus,
  describeWebhookProcessingDecision,
  FLUTTERWAVE_CHARGE_SUCCESS_TOPIC,
  FLUTTERWAVE_PROVIDER_NAME,
  FLUTTERWAVE_REFUND_COMPLETED_TOPIC,
  flutterwaveChargeWebhookSchema,
  flutterwaveRefundWebhookSchema,
  isWebhookSignatureValid,
} from "@/server/modules/payments/flutterwave.logic";
import { applyRefundCompletion } from "@/server/modules/payments/refunds.service";
import {
  getConfiguredPaymentProvider,
  PAYMENT_PROVIDER_NOT_CONFIGURED_CODE,
  PAYMENT_PROVIDER_NOT_CONFIGURED_MESSAGE,
  type VerifiedTransaction,
} from "@/server/modules/payments/provider";

// Flutterwave webhook intake. Delivery contract with the provider:
// - 200 with an outcome → the delivery is handled, Flutterwave stops retrying.
// - Any ApiError (401 signature, 502 provider verify) propagates so the route
//   answers with that status and Flutterwave retries the delivery.
//
// Trust model: the verif-hash header only proves the delivery came from
// Flutterwave. The payload itself is untrusted input — fulfilment happens only
// after an authenticated server-side verifyTransaction (verify-then-fulfil),
// and the verified amount/currency (never the webhook-claimed ones) are used.

export type FlutterwaveWebhookOutcome = "fulfilled" | "recorded" | "rejected" | "duplicate";

/** Ref appended to unparsable bodies so they are still dedupeable/auditable. */
function unparsedEventRef(rawBody: string): string {
  return `unparsed:${createHash("sha256").update(rawBody).digest("hex")}`;
}

/** Order ids are UUIDs; foreign/stale tx_refs must never reach a UUID-typed
 * Prisma lookup (that would 500 and trigger endless provider retries). */
function isLocalOrderRef(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

function readWebhookTopic(payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const event = (payload as { event?: unknown }).event;
    if (typeof event === "string") return event;
  }
  return "unknown";
}

function readProviderEventId(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/** A JSON value storable in the WebhookEvent.payload Json column. */
type WebhookPayload = Prisma.InputJsonValue;

interface WebhookEventRef {
  providerRef: string;
  topic: string;
  payload: WebhookPayload;
}

/** First sight → RECEIVED; redelivery → bump attempts and clear lastError. */
async function recordWebhookDelivery(
  exec: TransactionClient,
  event: WebhookEventRef,
): Promise<void> {
  await exec.webhookEvent.upsert({
    where: {
      provider_providerRef: {
        provider: FLUTTERWAVE_PROVIDER_NAME,
        providerRef: event.providerRef,
      },
    },
    create: {
      provider: FLUTTERWAVE_PROVIDER_NAME,
      providerRef: event.providerRef,
      topic: event.topic,
      payload: event.payload,
      status: WebhookEventStatus.RECEIVED,
    },
    update: { attempts: { increment: 1 }, lastError: null },
    select: { id: true },
  });
}

/** Terminal state (PROCESSED/FAILED/IGNORED) with a processedAt timestamp. */
async function completeWebhookEvent(
  exec: TransactionClient,
  event: WebhookEventRef,
  status: WebhookEventStatus,
  lastError: string | null = null,
): Promise<void> {
  await exec.webhookEvent.upsert({
    where: {
      provider_providerRef: {
        provider: FLUTTERWAVE_PROVIDER_NAME,
        providerRef: event.providerRef,
      },
    },
    create: {
      provider: FLUTTERWAVE_PROVIDER_NAME,
      providerRef: event.providerRef,
      topic: event.topic,
      payload: event.payload,
      status,
      lastError,
      processedAt: new Date(),
    },
    update: { status, lastError, processedAt: new Date() },
    select: { id: true },
  });
}

export async function processFlutterwaveWebhook(
  rawBody: string,
  verifHashHeader: string | null,
): Promise<FlutterwaveWebhookOutcome> {
  // Signature gate FIRST — before any parsing or DB access. An unset
  // FLUTTERWAVE_WEBHOOK_HASH makes every delivery invalid (fail-closed).
  const expectedHash = getServerEnv().FLUTTERWAVE_WEBHOOK_HASH ?? "";
  if (!isWebhookSignatureValid(verifHashHeader, expectedHash)) {
    throw new ApiError(
      401,
      PAYMENT_WEBHOOK_SIGNATURE_INVALID,
      "The webhook signature is missing or invalid.",
    );
  }

  // Parse defensively: a signature-valid body we cannot read is recorded as
  // FAILED under a content-derived ref for ops review, then acknowledged.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await completeWebhookEvent(
      db,
      { providerRef: unparsedEventRef(rawBody), topic: "unknown", payload: rawBody },
      WebhookEventStatus.FAILED,
      "Payload could not be parsed as JSON.",
    );
    return "recorded";
  }

  const topic = readWebhookTopic(payload);
  const providerEventId = readProviderEventId(payload);
  const providerRef = providerEventId !== null
    ? buildWebhookEventRef(topic, providerEventId)
    : unparsedEventRef(rawBody);
  const event: WebhookEventRef = {
    providerRef,
    topic,
    payload: payload as WebhookPayload,
  };

  // Dedupe on (provider, providerRef): a PROCESSED event is a redelivery.
  const existing = await db.webhookEvent.findUnique({
    where: {
      provider_providerRef: { provider: FLUTTERWAVE_PROVIDER_NAME, providerRef },
    },
    select: { status: true },
  });
  if (describeWebhookProcessingDecision(existing) === "SKIP") {
    return "duplicate";
  }

  if (topic !== FLUTTERWAVE_CHARGE_SUCCESS_TOPIC && topic !== FLUTTERWAVE_REFUND_COMPLETED_TOPIC) {
    // Flutterwave emits several lifecycle topics we do not act on; acknowledge
    // them as IGNORED so they stop retrying but remain auditable.
    await completeWebhookEvent(db, event, WebhookEventStatus.IGNORED);
    return "recorded";
  }

  if (topic === FLUTTERWAVE_REFUND_COMPLETED_TOPIC) {
    return processRefundWebhook(event, payload);
  }
  return processChargeWebhook(event, payload);
}

async function processRefundWebhook(
  event: WebhookEventRef,
  payload: unknown,
): Promise<FlutterwaveWebhookOutcome> {
  const parsed = flutterwaveRefundWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    await completeWebhookEvent(
      db,
      event,
      WebhookEventStatus.FAILED,
      "Refund webhook payload failed schema validation.",
    );
    return "recorded";
  }

  await recordWebhookDelivery(db, event);
  try {
    await applyRefundCompletion(parsed.data.data.id, parsed.data.data.status, event.providerRef);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      // Unknown refund id: keep the event FAILED for ops review, then let the
      // 404 reach the provider so its retries surface in our logs too.
      await completeWebhookEvent(
        db,
        event,
        WebhookEventStatus.FAILED,
        "Refund event references an unknown refund.",
      );
    }
    throw error;
  }
  await completeWebhookEvent(db, event, WebhookEventStatus.PROCESSED);
  return "recorded";
}

async function processChargeWebhook(
  event: WebhookEventRef,
  payload: unknown,
): Promise<FlutterwaveWebhookOutcome> {
  const parsed = flutterwaveChargeWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    await completeWebhookEvent(
      db,
      event,
      WebhookEventStatus.FAILED,
      "Charge webhook payload failed schema validation.",
    );
    return "recorded";
  }
  const charge = parsed.data.data;

  // Failed/abandoned checkouts are recorded and acknowledged; the ORDER stays
  // PENDING so the learner can retry with the same open order.
  const chargeStatus = classifyChargeEventStatus(charge.status);
  if (chargeStatus !== "SUCCESSFUL") {
    await withTransaction(async (tx) => {
      await completeWebhookEvent(tx, event, WebhookEventStatus.PROCESSED);
      // A non-UUID tx_ref belongs to another system; there is nothing to clean.
      if (!isLocalOrderRef(charge.tx_ref)) return;
      const order = await tx.order.findUnique({
        where: { id: charge.tx_ref },
        select: { id: true },
      });
      if (!order) return;
      // Only a PENDING payment flips to FAILED here — a captured payment is
      // never downgraded by a late failed event.
      await tx.payment.updateMany({
        where: {
          provider: FLUTTERWAVE_PROVIDER_NAME,
          orderId: order.id,
          status: PaymentStatus.PENDING,
        },
        data: { status: PaymentStatus.FAILED },
      });
    });
    return "recorded";
  }

  await recordWebhookDelivery(db, event);

  // Verify-then-fulfil: re-check the charge through the authenticated API.
  const provider = getConfiguredPaymentProvider();
  // Unreachable when the signature gate passed (env requires both keys), but
  // the type system still needs the guard.
  if (!provider) {
    await completeWebhookEvent(
      db,
      event,
      WebhookEventStatus.FAILED,
      "Payment provider became unconfigured.",
    );
    throw new ApiError(503, PAYMENT_PROVIDER_NOT_CONFIGURED_CODE, PAYMENT_PROVIDER_NOT_CONFIGURED_MESSAGE);
  }

  let verified: VerifiedTransaction;
  try {
    verified = await provider.verifyTransaction(String(charge.id));
  } catch (error) {
    // Provider/network fault: record FAILED and rethrow so the route answers
    // 502 and Flutterwave retries — this is the recovery path for outages.
    await completeWebhookEvent(
      db,
      event,
      WebhookEventStatus.FAILED,
      error instanceof Error ? error.message : "Transaction verification failed.",
    );
    throw error;
  }

  if (verified.status !== "SUCCESSFUL") {
    await completeWebhookEvent(
      db,
      event,
      WebhookEventStatus.PROCESSED,
      "Provider verify reported non-successful charge.",
    );
    return "rejected";
  }

  if (verified.localRef !== charge.tx_ref || !isLocalOrderRef(verified.localRef)) {
    // The webhook's tx_ref and the verified tx_ref disagree, or the verified
    // ref is not one of our order ids; trust the verified API and leave the
    // event IGNORED for ops review.
    await completeWebhookEvent(
      db,
      event,
      WebhookEventStatus.IGNORED,
      "Verified tx_ref does not match a local order.",
    );
    return "recorded";
  }

  try {
    await fulfilPaidOrder({
      orderId: verified.localRef,
      // The verified amount/currency are the server-owned figures; the
      // webhook-claimed amount is never used.
      payment: {
        providerRef: String(charge.id),
        amountMinor: verified.amountMinor,
        currency: verified.currency,
        payload: verified,
      },
      requestId: event.providerRef,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === PAYMENT_NOT_FOUND) {
      // A verified charge referencing a tx_ref this environment never created
      // (foreign/stale) is ignored, not failed.
      await completeWebhookEvent(
        db,
        event,
        WebhookEventStatus.IGNORED,
        "Verified charge references an unknown order.",
      );
      return "recorded";
    }
    if (
      error instanceof ApiError &&
      (error.code === PAYMENT_AMOUNT_MISMATCH ||
        error.code === PAYMENT_CURRENCY_MISMATCH ||
        error.code === PAYMENT_ORDER_MISMATCH)
    ) {
      // A genuinely mismatched payment must not 5xx forever: the decision is
      // recorded server-side and the delivery is acknowledged.
      await completeWebhookEvent(db, event, WebhookEventStatus.PROCESSED, error.code);
      return "recorded";
    }
    throw error;
  }

  await completeWebhookEvent(db, event, WebhookEventStatus.PROCESSED);
  return "fulfilled";
}
