import { z } from "zod";

// ---------------------------------------------------------------------------
// Named constants (no magic values)
// ---------------------------------------------------------------------------

/** The launch payment provider (business decision made for Phase 7). */
export const PAYMENT_PROVIDER_FLUTTERWAVE = "flutterwave";

/**
 * Query parameter Flutterwave redirects back with (?checkout={orderId}) so the
 * course page can reconcile the order it landed from.
 */
export const CHECKOUT_RETURN_PARAM = "checkout";

/** Client-matchable error codes shared by server and client. */
export const PAYMENT_NOT_FOUND = "PAYMENT_ORDER_NOT_FOUND";
export const PAYMENT_AMOUNT_MISMATCH = "PAYMENT_AMOUNT_MISMATCH";
export const PAYMENT_CURRENCY_MISMATCH = "PAYMENT_CURRENCY_MISMATCH";
export const PAYMENT_ORDER_MISMATCH = "PAYMENT_ORDER_MISMATCH";
export const PAYMENT_WEBHOOK_SIGNATURE_INVALID = "PAYMENT_WEBHOOK_SIGNATURE_INVALID";
export const REFUND_NOT_ALLOWED = "REFUND_NOT_ALLOWED";

/**
 * Client-safe tuples mirroring the Prisma enums without importing server-only
 * generated types into client bundles.
 */
export const ORDER_STATUSES = ["PENDING", "PAID", "FAILED", "CANCELLED", "REFUNDED"] as const;
export const PAYMENT_STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"] as const;

export type OrderStatusValue = (typeof ORDER_STATUSES)[number];
export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

/** Hosted-checkout session returned by POST /courses/{slug}/checkout. */
export const checkoutSessionSchema = z.object({
  provider: z.string().min(1),
  /** Local-side reference that provider events reconcile back to (the order id). */
  providerRef: z.string().min(1),
  /** Absolute hosted payment page URL the browser is redirected to. */
  checkoutUrl: z.string().url(),
});

/** Payment summary embedded in the order status read model. */
export const orderPaymentSummarySchema = z.object({
  provider: z.string().min(1),
  providerRef: z.string().min(1).nullable(),
  status: z.enum(PAYMENT_STATUSES),
});

/**
 * Order status read model for the recoverable pending state: after returning
 * from the hosted checkout the client polls/reconciles this instead of ever
 * trusting a client-side "payment succeeded" assumption.
 */
export const orderStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(ORDER_STATUSES),
  currency: z.string().length(3),
  totalMinor: z.number().int().nonnegative(),
  payment: orderPaymentSummarySchema.nullable(),
});

/** Body of POST /payments/orders/{orderId}/reconcile. */
export const reconcileOrderRequestSchema = z.object({
  /** Flutterwave transaction id from the redirect query (transaction_id=...). */
  transactionId: z.coerce.number().int().positive().optional(),
});

/** Body of POST /owner/payments/{paymentId}/refund. */
export const refundRequestSchema = z.object({
  /** Defaults to a full refund of the captured amount when omitted. */
  amountMinor: z.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
});

export type CheckoutSessionDto = z.infer<typeof checkoutSessionSchema>;
export type OrderPaymentSummaryDto = z.infer<typeof orderPaymentSummarySchema>;
export type OrderStatusDto = z.infer<typeof orderStatusSchema>;
export type ReconcileOrderRequest = z.infer<typeof reconcileOrderRequestSchema>;
export type RefundRequest = z.infer<typeof refundRequestSchema>;
