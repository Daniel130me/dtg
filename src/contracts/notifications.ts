import { z } from "zod";

// ---------------------------------------------------------------------------
// Named constants (no magic values)
// ---------------------------------------------------------------------------

/** Display-size limits enforced by the server and mirrored for client hints. */
export const NOTIFICATION_TITLE_MAX = 200;
export const NOTIFICATION_BODY_MAX = 500;
export const NOTIFICATION_LINK_MAX = 500;

/** Bounded reads: the learner's notification inbox page size. */
export const NOTIFICATION_PAGE_LIMIT_DEFAULT = 20;
export const NOTIFICATION_PAGE_LIMIT_MAX = 50;

/** Client-matchable error codes shared by server and client. */
export const NOTIFICATION_NOT_FOUND = "NOTIFICATION_NOT_FOUND";

// ---------------------------------------------------------------------------
// Query contracts
// ---------------------------------------------------------------------------

export const notificationListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NOTIFICATION_PAGE_LIMIT_MAX)
    .default(NOTIFICATION_PAGE_LIMIT_DEFAULT),
  // "true" restricts the page to unread rows (newest first either way).
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

export const notificationSchema = z.object({
  id: z.uuid(),
  topic: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  linkPath: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type NotificationDto = z.infer<typeof notificationSchema>;

/** The inbox page always carries the live unread badge count (1 extra count
 * query per page, pinned to the caller). */
export const paginatedNotificationsSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
});

export type PaginatedNotificationsDto = z.infer<typeof paginatedNotificationsSchema>;

export const unreadCountSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});

export type UnreadCountDto = z.infer<typeof unreadCountSchema>;
