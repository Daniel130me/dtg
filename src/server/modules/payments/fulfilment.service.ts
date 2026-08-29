import {
  EnrolmentSource,
  EnrolmentStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import {
  PAYMENT_CURRENCY_MISMATCH,
  PAYMENT_NOT_FOUND,
  PAYMENT_ORDER_MISMATCH,
} from "@/contracts/payments";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import {
  describeOrderFulfilmentDecision,
  checkPaymentEventMatchesOrder,
  FLUTTERWAVE_PROVIDER_NAME,
} from "@/server/modules/payments/flutterwave.logic";

// Fulfilment core: turns a SERVER-VERIFIED successful charge into order.paid +
// enrolment access. The decision functions come from flutterwave.logic.ts:
// describeOrderFulfilmentDecision makes reordered/duplicate events no-ops
// (ALREADY_FULFILLED) and blocks terminal states (REJECT), while
// checkPaymentEventMatchesOrder rejects amounts/currencies that do not match
// the server-owned order snapshot.

export interface FulfilPaymentInput {
  orderId: string;
  /** The verified payment figure — never the webhook-claimed one. */
  payment: {
    providerRef: string;
    amountMinor: number;
    currency: string;
    payload: unknown;
  };
  requestId: string;
}

export interface FulfilPaymentResult {
  fulfilled: boolean;
  alreadyFulfilled: boolean;
}

export async function fulfilPaidOrder(input: FulfilPaymentInput): Promise<FulfilPaymentResult> {
  // One read: the order with its items. The payment row is handled by the
  // upsert below (unique (provider, providerRef) covers create-vs-update), so
  // no separate pre-read is needed.
  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      userId: true,
      status: true,
      currency: true,
      totalMinor: true,
      items: { select: { id: true, courseId: true } },
    },
  });
  if (!order) {
    throw new ApiError(404, PAYMENT_NOT_FOUND, "The requested order does not exist.");
  }

  const decision = describeOrderFulfilmentDecision(order.status);
  if (decision === "ALREADY_FULFILLED") {
    return { fulfilled: false, alreadyFulfilled: true };
  }
  if (decision === "REJECT") {
    throw new ApiError(409, PAYMENT_ORDER_MISMATCH, "This order can no longer be fulfilled.");
  }

  // The paid amount/currency must match the server-owned order snapshot.
  const match = checkPaymentEventMatchesOrder({
    eventAmountMinor: input.payment.amountMinor,
    eventCurrency: input.payment.currency,
    orderTotalMinor: order.totalMinor,
    orderCurrency: order.currency,
  });
  if (!match.ok) {
    throw new ApiError(
      422,
      match.reason,
      match.reason === PAYMENT_CURRENCY_MISMATCH
        ? "The paid currency does not match the order currency."
        : "The paid amount does not match the order total.",
    );
  }

  await withTransaction(async (tx) => {
    // One payment row per provider transaction; a redelivery only refreshes
    // status/payload (the unique constraint is the concurrency guarantee).
    await tx.payment.upsert({
      where: {
        provider_providerRef: {
          provider: FLUTTERWAVE_PROVIDER_NAME,
          providerRef: input.payment.providerRef,
        },
      },
      create: {
        orderId: order.id,
        provider: FLUTTERWAVE_PROVIDER_NAME,
        providerRef: input.payment.providerRef,
        status: PaymentStatus.SUCCEEDED,
        amountMinor: input.payment.amountMinor,
        currency: input.payment.currency,
        payload: input.payment.payload as Prisma.InputJsonValue,
      },
      update: {
        status: PaymentStatus.SUCCEEDED,
        payload: input.payment.payload as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PAID },
      select: { id: true },
    });

    // Grant access per order line. An existing enrolment keeps its identity
    // (source/orderItemId are never overwritten): an owner-granted enrolment
    // stays an owner grant, it only gets linked to this line when unlinked.
    for (const item of order.items) {
      const enrolment = await tx.enrolment.findUnique({
        where: { userId_courseId: { userId: order.userId, courseId: item.courseId } },
        select: { id: true, status: true, orderItemId: true },
      });

      if (!enrolment) {
        const created = await tx.enrolment.create({
          data: {
            userId: order.userId,
            courseId: item.courseId,
            source: EnrolmentSource.PURCHASE,
            status: EnrolmentStatus.ACTIVE,
            orderItemId: item.id,
          },
          select: { id: true },
        });
        // Denormalized counter only ever increments on first-time enrolment.
        await tx.course.update({
          where: { id: item.courseId },
          data: { enrollmentCount: { increment: 1 } },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: order.userId,
            action: "enrolment.created",
            entityType: "Enrolment",
            entityId: created.id,
            requestId: input.requestId,
            metadata: { courseId: item.courseId, source: "PURCHASE", orderId: order.id },
          },
          select: { id: true },
        });
      } else if (enrolment.status === EnrolmentStatus.REVOKED) {
        const reactivated = await tx.enrolment.update({
          where: { id: enrolment.id },
          data: {
            status: EnrolmentStatus.ACTIVE,
            revokedAt: null,
            ...(enrolment.orderItemId ? {} : { orderItemId: item.id }),
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: order.userId,
            action: "enrolment.reactivated",
            entityType: "Enrolment",
            entityId: reactivated.id,
            requestId: input.requestId,
            metadata: { courseId: item.courseId, orderId: order.id },
          },
          select: { id: true },
        });
      } else if (!enrolment.orderItemId) {
        await tx.enrolment.update({
          where: { id: enrolment.id },
          data: { orderItemId: item.id },
          select: { id: true },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        actorUserId: order.userId,
        action: "order.paid",
        entityType: "Order",
        entityId: order.id,
        requestId: input.requestId,
        metadata: {
          provider: FLUTTERWAVE_PROVIDER_NAME,
          providerRef: input.payment.providerRef,
          amountMinor: input.payment.amountMinor,
          currency: input.payment.currency,
        },
      },
      select: { id: true },
    });
  });

  return { fulfilled: true, alreadyFulfilled: false };
}
