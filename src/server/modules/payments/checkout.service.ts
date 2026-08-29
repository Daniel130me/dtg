import { CourseStatus, OrderStatus } from "@prisma/client";
import { FREE_PRICE_MINOR } from "@/contracts/catalog";
import { CHECKOUT_RETURN_PARAM } from "@/contracts/payments";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { getServerEnv } from "@/server/config/env";
import { ApiError } from "@/server/http/errors";
import { FLUTTERWAVE_PROVIDER_NAME } from "@/server/modules/payments/flutterwave.logic";
import {
  requirePaymentProvider,
  type CheckoutLineItem,
  type CheckoutSession,
} from "@/server/modules/payments/provider";

/**
 * Starts a paid checkout for a single course.
 *
 * Guarantees:
 * - The price/currency snapshot is always read from the database here — client
 *   supplied prices are never trusted (Phase 7 exit gate).
 * - Retrying checkout reuses the same open PENDING order instead of stacking
 *   duplicate orders.
 * - The provider HTTP call never runs inside a DB transaction (no tx is held
 *   across network I/O); if it throws, the PENDING order simply remains —
 *   harmless, because the next attempt reuses that same open order.
 */
export async function initializeCheckout(userId: string, slug: string): Promise<CheckoutSession> {
  // Fail closed before any write when the launch provider is not configured.
  const provider = requirePaymentProvider();

  const [course, user] = await Promise.all([
    db.course.findUnique({
      where: { slug },
      select: { id: true, title: true, status: true, priceMinor: true, currency: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
  ]);
  if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The requested course does not exist.");
  if (course.status !== CourseStatus.PUBLISHED) {
    throw new ApiError(422, "COURSE_NOT_PUBLISHED", "This course is not open for enrolment.");
  }
  if (course.priceMinor <= FREE_PRICE_MINOR) {
    throw new ApiError(422, "COURSE_IS_FREE", "This course is free and does not require checkout.");
  }
  if (!user) {
    throw new ApiError(401, "SESSION_INVALID", "The session is no longer valid.");
  }

  // Reuse any still-open order for this course (newest first) so retrying a
  // failed checkout never creates unbounded PENDING orders.
  const openOrder = await db.order.findFirst({
    where: { userId, status: OrderStatus.PENDING, items: { some: { courseId: course.id } } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });

  let orderId: string;
  if (openOrder) {
    orderId = openOrder.id;
  } else {
    const created = await withTransaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          userId,
          status: OrderStatus.PENDING,
          currency: course.currency,
          totalMinor: course.priceMinor,
          provider: FLUTTERWAVE_PROVIDER_NAME,
        },
        select: { id: true },
      });
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          courseId: course.id,
          // Snapshots come from the DB row only: the client never supplies
          // price or currency.
          unitPriceMinor: course.priceMinor,
          currency: course.currency,
        },
        select: { id: true },
      });
      return order;
    });
    orderId = created.id;
  }

  const items: CheckoutLineItem[] = [
    {
      courseId: course.id,
      title: course.title,
      unitPriceMinor: course.priceMinor,
      currency: course.currency,
    },
  ];

  const successUrl = `${getServerEnv().APP_URL}/courses/${encodeURIComponent(slug)}?${CHECKOUT_RETURN_PARAM}=${orderId}`;
  // Flutterwave has a single redirect_url (it does not branch on cancel), so
  // the cancelUrl field stays on the neutral interface for other providers but
  // is intentionally empty here.
  const session = await provider.createCheckoutSession({
    userId,
    orderId,
    items,
    customer: { email: user.email, name: user.name },
    successUrl,
    cancelUrl: "",
  });

  // Persist only after the provider accepted the session. providerRef = the
  // tx_ref we sent = the local order id (webhooks reconcile through it).
  await db.order.update({
    where: { id: orderId },
    data: { providerRef: orderId },
    select: { id: true },
  });

  return session;
}
