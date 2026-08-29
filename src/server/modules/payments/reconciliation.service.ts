import { OrderStatus, Prisma } from "@prisma/client";
import { PAYMENT_NOT_FOUND } from "@/contracts/payments";
import type { OrderStatusDto, ReconcileOrderRequest } from "@/contracts/payments";
import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import { fulfilPaidOrder } from "@/server/modules/payments/fulfilment.service";
import { getConfiguredPaymentProvider } from "@/server/modules/payments/provider";

// Order status reads + reconciliation. Every query is ownership-pinned
// (where: { id, userId }) so a learner probing someone else's order id gets
// the same 404 as an unknown id — existence is never leaked.

/** One query returns the order read model plus its latest payment summary. */
const ORDER_WITH_LATEST_PAYMENT_SELECT = {
  id: true,
  status: true,
  currency: true,
  totalMinor: true,
  payments: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { provider: true, providerRef: true, status: true },
  },
} satisfies Prisma.OrderSelect;

type OrderWithPaymentRow = Prisma.OrderGetPayload<{
  select: typeof ORDER_WITH_LATEST_PAYMENT_SELECT;
}>;

function toOrderStatusDto(row: OrderWithPaymentRow): OrderStatusDto {
  const payment = row.payments[0];
  return {
    id: row.id,
    status: row.status,
    currency: row.currency,
    totalMinor: row.totalMinor,
    payment: payment
      ? { provider: payment.provider, providerRef: payment.providerRef, status: payment.status }
      : null,
  };
}

export async function getOrderStatusForUser(userId: string, orderId: string): Promise<OrderStatusDto> {
  const order = await db.order.findFirst({
    where: { id: orderId, userId },
    select: ORDER_WITH_LATEST_PAYMENT_SELECT,
  });
  if (!order) {
    throw new ApiError(404, PAYMENT_NOT_FOUND, "The requested order does not exist.");
  }
  return toOrderStatusDto(order);
}

/**
 * Reconciles a PENDING order after the learner returns from the hosted
 * checkout. Flow:
 * - PAID → returned as-is (idempotent).
 * - PENDING with a known provider transaction → verify that transaction, then
 *   fulfil when the provider confirms it.
 * - PENDING without a payment and a redirect transactionId given → verify it,
 *   and fulfil ONLY if its localRef (tx_ref) maps back to this order.
 * Mismatched or closed orders must not crash the learner's UI: fulfilment
 * rejections are recorded server-side (payment status, webhook/event audit)
 * and the still-PENDING status is returned.
 */
export async function reconcileOrderForUser(
  userId: string,
  orderId: string,
  input: ReconcileOrderRequest,
  requestId: string,
): Promise<OrderStatusDto> {
  const order = await db.order.findFirst({
    where: { id: orderId, userId },
    select: ORDER_WITH_LATEST_PAYMENT_SELECT,
  });
  if (!order) {
    throw new ApiError(404, PAYMENT_NOT_FOUND, "The requested order does not exist.");
  }

  if (order.status !== OrderStatus.PENDING) {
    // PAID/FAILED/CANCELLED/REFUNDED are terminal for reconciliation.
    return toOrderStatusDto(order);
  }

  const provider = getConfiguredPaymentProvider();
  const payment = order.payments[0];

  try {
    if (provider && payment?.providerRef) {
      // We already know the provider transaction: verify it directly.
      const verified = await provider.verifyTransaction(payment.providerRef);
      if (verified.status === "SUCCESSFUL") {
        await fulfilPaidOrder({
          orderId: order.id,
          payment: {
            providerRef: payment.providerRef,
            amountMinor: verified.amountMinor,
            currency: verified.currency,
            payload: verified,
          },
          requestId,
        });
      }
    } else if (provider && input.transactionId !== undefined) {
      // Fallback for a redirect whose payment row never materialised: the
      // given transaction is only trusted when it maps back to THIS order.
      const verified = await provider.verifyTransaction(String(input.transactionId));
      if (verified.status === "SUCCESSFUL" && verified.localRef === order.id) {
        await fulfilPaidOrder({
          orderId: order.id,
          payment: {
            providerRef: verified.providerRef,
            amountMinor: verified.amountMinor,
            currency: verified.currency,
            payload: verified,
          },
          requestId,
        });
      }
    }
  } catch (error) {
    // A genuinely mismatched/unfulfillable payment must not 5xx the learner's
    // return trip: it is recorded server-side (fulfilment audit trail) and the
    // order simply stays PENDING for ops review.
    if (error instanceof ApiError && (error.status === 422 || error.status === 409)) {
      return getOrderStatusForUser(userId, orderId);
    }
    throw error; // 502 provider faults surface as PAYMENT_PROVIDER_ERROR.
  }

  // Always return the fresh status (fulfilment may have just flipped it).
  return getOrderStatusForUser(userId, orderId);
}
