import type { z } from "zod";
import {
  enrolmentListQuerySchema,
  type CourseEnrolmentStateDto,
  type EnrolmentDto,
  type PaginatedEnrolmentsDto,
} from "@/contracts/enrolments";
import { apiRequest } from "@/lib/client/api-client";

const LEARNING_BASE_PATH = "/api/v1";

/**
 * Input form of the enrolment list query. The API applies the schema default
 * for `limit` (see enrolmentListQuerySchema), so callers only send the fields
 * they care about — e.g. fetchMyEnrolments({ status: "ACTIVE" }). The
 * contract's exported `EnrolmentListQuery` is the *output* type (defaults
 * filled in); deriving the input type from the same schema keeps everything
 * in sync.
 */
export type EnrolmentListQueryInput = z.input<typeof enrolmentListQuerySchema>;

/** Serializes the query to a query string, skipping empty values so API defaults apply. */
function buildEnrolmentQueryString(query: EnrolmentListQueryInput): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/** GET /api/v1/learning/enrolments — the signed-in learner's paginated enrolment list. */
export function fetchMyEnrolments(
  query: EnrolmentListQueryInput,
): Promise<PaginatedEnrolmentsDto> {
  const queryString = buildEnrolmentQueryString(query);
  const path = queryString
    ? `${LEARNING_BASE_PATH}/learning/enrolments?${queryString}`
    : `${LEARNING_BASE_PATH}/learning/enrolments`;
  return apiRequest<PaginatedEnrolmentsDto>(path);
}

/** GET /api/v1/courses/{slug}/enrolment — lightweight `enrolled?` probe for the detail-page CTA. */
export function fetchCourseEnrolmentState(slug: string): Promise<CourseEnrolmentStateDto> {
  return apiRequest<CourseEnrolmentStateDto>(
    `${LEARNING_BASE_PATH}/courses/${encodeURIComponent(slug)}/enrolment`,
  );
}

/**
 * POST /api/v1/courses/{slug}/enroll — idempotent free enrolment (re-calling
 * returns the existing/active enrolment). Unwraps the `{ enrolment }` envelope.
 */
export async function enrollInCourse(slug: string): Promise<EnrolmentDto> {
  const payload = await apiRequest<{ enrolment: EnrolmentDto }>(
    `${LEARNING_BASE_PATH}/courses/${encodeURIComponent(slug)}/enroll`,
    { method: "POST" },
  );
  return payload.enrolment;
}
