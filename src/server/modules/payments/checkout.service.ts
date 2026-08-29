import { FREE_PRICE_MINOR } from "@/contracts/catalog";
import { CourseStatus } from "@prisma/client";
import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import {
  requirePaymentProvider,
  type CheckoutSession,
} from "@/server/modules/payments/provider";

/**
 * Starts a paid checkout for a single course.
 *
 * The price/currency snapshot is always read from the database here — client
 * supplied prices are never trusted (Phase 7 exit gate). The order row is
 * created together with the provider session once a launch provider exists;
 * until then this fails closed before any write happens.
 */
export async function initializeCheckout(userId: string, slug: string): Promise<CheckoutSession> {
  const course = await db.course.findUnique({
    where: { slug },
    select: { id: true, title: true, status: true, priceMinor: true, currency: true },
  });
  if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The requested course does not exist.");
  if (course.status !== CourseStatus.PUBLISHED) {
    throw new ApiError(422, "COURSE_NOT_PUBLISHED", "This course is not open for enrolment.");
  }
  if (course.priceMinor <= FREE_PRICE_MINOR) {
    throw new ApiError(422, "COURSE_IS_FREE", "This course is free and does not require checkout.");
  }

  const provider = requirePaymentProvider();

  // Unreachable until a provider ships: order creation + provider session
  // (one transaction, providerRef reconciled idempotently) lands with the
  // concrete provider milestone.
  return provider.createCheckoutSession({
    userId,
    orderId: "unreachable",
    items: [
      {
        courseId: course.id,
        title: course.title,
        unitPriceMinor: course.priceMinor,
        currency: course.currency,
      },
    ],
    successUrl: "/learning",
    cancelUrl: `/courses/${slug}`,
  });
}
