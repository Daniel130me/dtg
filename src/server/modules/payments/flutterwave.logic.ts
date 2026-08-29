import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  PAYMENT_AMOUNT_MISMATCH,
  PAYMENT_CURRENCY_MISMATCH,
  PAYMENT_PROVIDER_FLUTTERWAVE,
} from "@/contracts/payments";

// Pure, DB-free and network-free Flutterwave rules so they stay unit-testable.
// The provider module (flutterwave.provider.ts) owns the actual HTTP calls.

export const FLUTTERWAVE_API_BASE_URL = "https://api.flutterwave.com/v3";
export const FLUTTERWAVE_PROVIDER_NAME = PAYMENT_PROVIDER_FLUTTERWAVE;
export const FLUTTERWAVE_CHARGE_SUCCESS_TOPIC = "charge.completed";
export const FLUTTERWAVE_REFUND_COMPLETED_TOPIC = "refund.completed";
/** data.status value Flutterwave sends on the refund.completed webhook. */
export const FLUTTERWAVE_REFUND_COMPLETED_STATUS = "completed";
export const FLUTTERWAVE_REQUEST_TIMEOUT_MS = 10_000;
export const FLUTTERWAVE_CHECKOUT_TITLE = "DTG Learning";

/** Client-matchable code for any Flutterwave API fault (details never leak). */
export const FLUTTERWAVE_PROVIDER_ERROR = "PAYMENT_PROVIDER_ERROR";

// ---------------------------------------------------------------------------
// Money: the platform speaks integer minor units everywhere; Flutterwave's API
// speaks 2-decimal major units for every currency it supports. Convert only at
// the provider edge.
// ---------------------------------------------------------------------------

export function minorToMajorUnits(amountMinor: number): number {
  return amountMinor / 100;
}

export function majorToMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

// ---------------------------------------------------------------------------
// Webhook signature: Flutterwave signs deliveries with the dashboard secret in
// the verif-hash header. Both sides are hashed before comparing so the lengths
// always match (timingSafeEqual throws on length mismatch) and comparison is
// timing-safe.
// ---------------------------------------------------------------------------

export function isWebhookSignatureValid(
  receivedHash: string | null,
  expectedHash: string,
): boolean {
  if (!receivedHash || !expectedHash) return false;
  const received = createHash("sha256").update(receivedHash).digest();
  const expected = createHash("sha256").update(expectedHash).digest();
  return timingSafeEqual(received, expected);
}

// ---------------------------------------------------------------------------
// Webhook payload schemas (Flutterwave v3 event shapes we act on).
// ---------------------------------------------------------------------------

export const flutterwaveChargeWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    id: z.number().int().positive(),
    tx_ref: z.string().min(1),
    status: z.string(),
    amount: z.number().positive(),
    currency: z.string().length(3),
  }),
});

export const flutterwaveRefundWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    id: z.number().int().positive(),
    status: z.string(),
    transaction_id: z.number().int().positive(),
  }),
});

// ---------------------------------------------------------------------------
// Event classification and matching.
// ---------------------------------------------------------------------------

export type VerifiedChargeStatus = "SUCCESSFUL" | "FAILED" | "UNKNOWN";

export function classifyChargeEventStatus(status: string): VerifiedChargeStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "successful") return "SUCCESSFUL";
  if (normalized === "failed" || normalized === "cancelled") return "FAILED";
  return "UNKNOWN";
}

export type PaymentEventMismatch = typeof PAYMENT_AMOUNT_MISMATCH | typeof PAYMENT_CURRENCY_MISMATCH;

export function checkPaymentEventMatchesOrder(event: {
  eventAmountMinor: number;
  eventCurrency: string;
  orderTotalMinor: number;
  orderCurrency: string;
}): { ok: true } | { ok: false; reason: PaymentEventMismatch } {
  if (event.eventAmountMinor !== event.orderTotalMinor) {
    return { ok: false, reason: PAYMENT_AMOUNT_MISMATCH };
  }
  if (event.eventCurrency !== event.orderCurrency) {
    return { ok: false, reason: PAYMENT_CURRENCY_MISMATCH };
  }
  return { ok: true };
}

/** Dedupe key for WebhookEvent(provider, providerRef), e.g. "charge.completed:12345". */
export function buildWebhookEventRef(topic: string, providerEventId: number): string {
  return `${topic}:${providerEventId}`;
}

// ---------------------------------------------------------------------------
// Processing decisions (kept pure so replay/retry semantics are testable).
// ---------------------------------------------------------------------------

type WebhookEventStatusValue = "RECEIVED" | "PROCESSED" | "FAILED" | "IGNORED";
type OrderStatusValue = "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "REFUNDED";

/**
 * Redelivery decision for a previously stored webhook event: only a PROCESSED
 * event is a duplicate (SKIP); first deliveries and FAILED/RECEIVED leftovers
 * are retried so the recovery path can run again.
 */
export function describeWebhookProcessingDecision(
  existing: { status: WebhookEventStatusValue } | null,
): "SKIP" | "RETRY" {
  return existing?.status === "PROCESSED" ? "SKIP" : "RETRY";
}

/**
 * Fulfilment decision for an order that a successful charge claims to pay:
 * PENDING orders are fulfilled, PAID orders make reordered/duplicate events a
 * no-op, and terminal-failure states must never be resurrected.
 */
export function describeOrderFulfilmentDecision(
  orderStatus: OrderStatusValue,
): "FULFIL" | "ALREADY_FULFILLED" | "REJECT" {
  switch (orderStatus) {
    case "PENDING":
      return "FULFIL";
    case "PAID":
      return "ALREADY_FULFILLED";
    default:
      return "REJECT";
  }
}
