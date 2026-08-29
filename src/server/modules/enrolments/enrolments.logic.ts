// Pure, DB-free enrolment rules so they stay unit-testable without a database.

export type FreeEnrolmentBlocker = "COURSE_NOT_PUBLISHED" | "PAID_COURSE_REQUIRES_CHECKOUT";

export interface FreeEnrolmentEligibility {
  eligible: boolean;
  /** Present only when eligible is false. */
  blocker: FreeEnrolmentBlocker | null;
}

/**
 * Direct enrolment is for PUBLISHED courses only; paid courses must go through
 * checkout (Phase 7 payments milestone) instead of free enrolment.
 */
export function describeFreeEnrolmentEligibility(course: {
  status: string;
  priceMinor: number;
  freePriceMinor: number;
}): FreeEnrolmentEligibility {
  if (course.status !== "PUBLISHED") {
    return { eligible: false, blocker: "COURSE_NOT_PUBLISHED" };
  }
  if (course.priceMinor > course.freePriceMinor) {
    return { eligible: false, blocker: "PAID_COURSE_REQUIRES_CHECKOUT" };
  }
  return { eligible: true, blocker: null };
}
