import {
  EnrolmentStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from "@prisma/client";
import { PAYMENT_NOT_FOUND, REFUND_NOT_ALLOWED } from "@/contracts/payments";
import type { RefundRequest } from "@/contracts/payments";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import {
  FLUTTERWAVE_PROVIDER_NAME,
  FLUTTERWAVE_REFUND_COMPLETED_STATUS,
} from "@/server/modules/payments/flutterwave.logic";
import { requirePaymentProvider } from "@/server/modules/payments/provider";

// Refunds. Two entry points:
// - requestRefund: the owner asks Flutterwave to refund a captured payment.
// - applyRefundCompletion: the refund.completed webhook settles the Refund row.
//
// Access policy: enrolment access is revoked on refund COMPLETION (the webhook),
// not on the refund request, because Flutterwave refunds are asynchronous — the
// money is only truly returned once the provider confirms.

export interface RefundDto {
  id: string;
  status: RefundStatus;
  amountMinor: number;
  providerRef: string | null;
}

/** One query loads the payment with its order, order items, and each item's
 * linked enrolment — everything the refund decision and the later revocation
 * need. */
const REFUND_WITH_ORDER_SELECT = {
  id: true,
  provider: true,
  providerRef: true,
  status: true,
  amountMinor: true,
  currency: true,
  order: {
    select: {
      id: true,
      items: {
        select: { id: true, enrolment: { select: { id: true } } },
      },
    },
  },
} satisfies Prisma.PaymentSelect;

export async function requestRefund(
  paymentId: string,
  input: RefundRequest,
  actorOwnerId: string,
  requestId: string,
): Promise<RefundDto> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: REFUND_WITH_ORDER_SELECT,
  });
  if (!payment) {
    throw new ApiError(404, PAYMENT_NOT_FOUND, "The requested payment does not exist.");
  }

  // Only captured money can be refunded, and a partial refund can never exceed
  // the captured amount.
  if (payment.status !== PaymentStatus.SUCCEEDED) {
    throw new ApiError(422, REFUND_NOT_ALLOWED, "Only captured payments can be refunded.");
  }
  if (input.amountMinor !== undefined && input.amountMinor > payment.amountMinor) {
    throw new ApiError(422, REFUND_NOT_ALLOWED, "The refund amount exceeds the captured amount.");
  }
  if (!payment.providerRef) {
    throw new ApiError(422, REFUND_NOT_ALLOWED, "The payment has no provider transaction to refund.");
  }

  // The payment was created by the configured provider, so the provider
  // boundary is safe to use here (it fails closed with 503 when unset).
  const provider = requirePaymentProvider();
  const result = await provider.refundTransaction(
    payment.providerRef,
    input.amountMinor ?? null,
    payment.currency,
  );

  const refund = await db.refund.create({
    data: {
      paymentId: payment.id,
      provider: payment.provider,
      providerRef: result.providerRef,
      status: result.status,
      amountMinor: input.amountMinor ?? payment.amountMinor,
      currency: payment.currency,
      reason: input.reason ?? null,
    },
    select: { id: true, status: true, amountMinor: true, providerRef: true },
  });

  await db.auditLog.create({
    data: {
      actorUserId: actorOwnerId,
      action: "payment.refund_requested",
      entityType: "Payment",
      entityId: payment.id,
      requestId,
      metadata: {
        refundId: refund.id,
        amountMinor: refund.amountMinor,
        currency: payment.currency,
        orderId: payment.order.id,
      },
    },
    select: { id: true },
  });

  return {
    id: refund.id,
    status: refund.status,
    amountMinor: refund.amountMinor,
    providerRef: refund.providerRef,
  };
}

/**
 * Settles a refund from the refund.completed webhook. An unknown refund id
 * throws 404 so the webhook event is kept FAILED for ops review instead of
 * being silently acknowledged.
 */
export async function applyRefundCompletion(
  refundEventId: number,
  status: string,
  requestId: string,
): Promise<void> {
  const refund = await db.refund.findUnique({
    where: {
      provider_providerRef: {
        provider: FLUTTERWAVE_PROVIDER_NAME,
        providerRef: String(refundEventId),
      },
    },
    select: {
      id: true,
      status: true,
      payment: {
        select: {
          id: true,
          order: {
            select: {
              id: true,
              items: { select: { id: true, enrolment: { select: { id: true } } } },
            },
          },
        },
      },
    },
  });
  if (!refund) {
    throw new ApiError(404, PAYMENT_NOT_FOUND, "The referenced refund does not exist.");
  }

  // Anything other than a completed refund leaves the rows untouched; the
  // webhook event is still recorded (PROCESSED) by the caller.
  if (status !== FLUTTERWAVE_REFUND_COMPLETED_STATUS) return;

  await withTransaction(async (tx) => {
    await tx.refund.update({
      where: { id: refund.id },
      data: { status: RefundStatus.SUCCEEDED },
      select: { id: true },
    });
    await tx.payment.update({
      where: { id: refund.payment.id },
      data: { status: PaymentStatus.REFUNDED },
      select: { id: true },
    });
    await tx.order.update({
      where: { id: refund.payment.order.id },
      data: { status: OrderStatus.REFUNDED },
      select: { id: true },
    });

    // Revoke access for every enrolment linked to this payment's order lines.
    for (const item of refund.payment.order.items) {
      if (!item.enrolment) continue;
      await tx.enrolment.update({
        where: { id: item.enrolment.id },
        data: { status: EnrolmentStatus.REVOKED, revokedAt: new Date() },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          // AuditLog.actorUserId is nullable: webhook-driven revocations have
          // no human actor, so the actor is null and metadata names the cause.
          actorUserId: null,
          action: "enrolment.revoked",
          entityType: "Enrolment",
          entityId: item.enrolment.id,
          requestId,
          metadata: { revokedBy: "refund", orderId: refund.payment.order.id },
        },
        select: { id: true },
      });
    }
  });
}
