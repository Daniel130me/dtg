import type {
  PaginatedNotificationsDto,
  UnreadCountDto,
  notificationListQuerySchema,
} from "@/contracts/notifications";
import type {
  PaginatedOwnerReviewsDto,
  PaginatedReviewsDto,
  ReviewDto,
  ownerReviewListQuerySchema,
  reviewListQuerySchema,
  reviewStatusParamSchema,
  reviewUpsertSchema,
} from "@/contracts/reviews";
import type { z } from "zod";
import { apiRequest } from "@/lib/client/api-client";

// ---------------------------------------------------------------------------
// Phase 10 — engagement workflows: course reviews, in-app notifications,
// and the public support contact form.
//
// One module owns every engagement call so parallel feature work never
// co-edits the shared api clients. Envelope unwrapping follows the same
// convention as features/learning/api.ts: documented per call.
// ---------------------------------------------------------------------------

const BASE_PATH = "/api/v1";

/** Serializes a query object to a query string, skipping empty values. */
function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

// ---------------------------------------------------------------------------
// Reviews — public course reviews + the learner's own review
// ---------------------------------------------------------------------------

export type ReviewListQueryInput = z.input<typeof reviewListQuerySchema>;

/** GET /courses/{slug}/reviews — public VISIBLE-only review page. */
export function listCourseReviews(
  slug: string,
  query: ReviewListQueryInput,
): Promise<PaginatedReviewsDto> {
  const queryString = buildQueryString(query);
  const path = `${BASE_PATH}/courses/${encodeURIComponent(slug)}/reviews${queryString ? `?${queryString}` : ""}`;
  return apiRequest<PaginatedReviewsDto>(path);
}

/** GET /courses/{slug}/reviews/mine — the caller's own review or null. */
export async function fetchMyReview(slug: string): Promise<ReviewDto | null> {
  return apiRequest<ReviewDto | null>(
    `${BASE_PATH}/courses/${encodeURIComponent(slug)}/reviews/mine`,
  );
}

/** PUT /courses/{slug}/reviews/mine — create-or-update the caller's review. */
export async function upsertMyReview(
  slug: string,
  input: z.output<typeof reviewUpsertSchema>,
): Promise<ReviewDto> {
  const payload = await apiRequest<{ review: ReviewDto }>(
    `${BASE_PATH}/courses/${encodeURIComponent(slug)}/reviews/mine`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return payload.review;
}

/** DELETE /courses/{slug}/reviews/mine — withdraw the caller's review. */
export async function deleteMyReview(slug: string): Promise<void> {
  await apiRequest(`${BASE_PATH}/courses/${encodeURIComponent(slug)}/reviews/mine`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Reviews — owner moderation
// ---------------------------------------------------------------------------

export type OwnerReviewListQueryInput = z.input<typeof ownerReviewListQuerySchema>;

/** GET /owner/reviews — moderation page across all courses. */
export function listOwnerReviews(
  query: OwnerReviewListQueryInput,
): Promise<PaginatedOwnerReviewsDto> {
  const queryString = buildQueryString(query);
  const path = `${BASE_PATH}/owner/reviews${queryString ? `?${queryString}` : ""}`;
  return apiRequest<PaginatedOwnerReviewsDto>(path);
}

/** PUT /owner/reviews/{reviewId}/status — hide or restore a review. */
export async function moderateReview(
  reviewId: string,
  status: z.output<typeof reviewStatusParamSchema>,
): Promise<ReviewDto> {
  const payload = await apiRequest<{ review: ReviewDto }>(
    `${BASE_PATH}/owner/reviews/${encodeURIComponent(reviewId)}/status`,
    { method: "PUT", body: JSON.stringify({ status }) },
  );
  return payload.review;
}

/** PUT /owner/reviews/{reviewId}/reply — upsert the owner reply. */
export async function replyToReview(reviewId: string, reply: string): Promise<ReviewDto> {
  const payload = await apiRequest<{ review: ReviewDto }>(
    `${BASE_PATH}/owner/reviews/${encodeURIComponent(reviewId)}/reply`,
    { method: "PUT", body: JSON.stringify({ reply }) },
  );
  return payload.review;
}

// ---------------------------------------------------------------------------
// Notifications — the learner's in-app inbox
// ---------------------------------------------------------------------------

export type NotificationListQueryInput = z.input<typeof notificationListQuerySchema>;

/** GET /learning/notifications — the caller's inbox page + unread count. */
export function listNotifications(
  query: NotificationListQueryInput,
): Promise<PaginatedNotificationsDto> {
  const queryString = buildQueryString(query);
  const path = `${BASE_PATH}/learning/notifications${queryString ? `?${queryString}` : ""}`;
  return apiRequest<PaginatedNotificationsDto>(path);
}

/** GET /learning/notifications/unread-count — badge count probe. */
export function fetchUnreadNotificationCount(): Promise<UnreadCountDto> {
  return apiRequest<UnreadCountDto>(`${BASE_PATH}/learning/notifications/unread-count`);
}

/** POST /learning/notifications/{id}/read — idempotent mark-read. */
export async function markNotificationRead(notificationId: string): Promise<void> {
  await apiRequest(
    `${BASE_PATH}/learning/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "POST" },
  );
}

/** POST /learning/notifications/read-all — mark every unread row read. */
export async function markAllNotificationsRead(): Promise<number> {
  const payload = await apiRequest<{ updatedCount: number }>(
    `${BASE_PATH}/learning/notifications/read-all`,
    { method: "POST" },
  );
  return payload.updatedCount;
}

// ---------------------------------------------------------------------------
// Support contact — public submission form
// ---------------------------------------------------------------------------

export interface ContactSubmissionInput {
  name: string;
  email: string;
  subject: string;
  message: string;
  /** Honeypot: real users never fill this (rendered hidden and empty). */
  website?: string;
}

/** POST /support/contact — validated + rate-limited public submission. */
export async function submitContact(input: ContactSubmissionInput): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(`${BASE_PATH}/support/contact`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
