import { Prisma } from "@prisma/client";
import {
  NOTIFICATION_NOT_FOUND,
  notificationListQuerySchema,
  type NotificationDto,
  type PaginatedNotificationsDto,
  type UnreadCountDto,
} from "@/contracts/notifications";
import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";

// Authorization model: the learner's inbox is a private read model. Every
// query below is pinned to the caller's userId (requireAuthenticatedUser in
// the route resolves the id; services never trust client-supplied ids), so a
// learner can only ever list or mutate their own rows.

const NOTIFICATION_SELECT = {
  id: true,
  topic: true,
  title: true,
  body: true,
  linkPath: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>;

function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    topic: row.topic,
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The caller's notification page, newest first, keyset-paginated over
 * (createdAt desc, id desc) — same shape as the enrolments list. The page
 * always carries the live unread badge count.
 *
 * Query budget: 3 (page + total + unread count) — within the 4-query budget.
 */
export async function listNotifications(userId: string, input: unknown): Promise<PaginatedNotificationsDto> {
  const query = notificationListQuerySchema.parse(input);

  const where: Prisma.NotificationWhereInput = {
    userId,
    // unreadOnly filters the PAGE only; the unread badge stays global.
    ...(query.unreadOnly === "true" ? { readAt: null } : {}),
  };
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    const cursorDate = new Date(cursor.createdAt);
    where.AND = [
      {
        OR: [
          { createdAt: { lt: cursorDate } },
          { createdAt: cursorDate, id: { lt: cursor.id } },
        ],
      },
    ];
  }

  const [rows, total, unreadCount] = await Promise.all([
    db.notification.findMany({
      where,
      select: NOTIFICATION_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = items.at(-1);

  return {
    items: items.map(toNotificationDto),
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
        : null,
    total,
    unreadCount,
  };
}

/** One count for the bell badge. */
export async function getUnreadNotificationCount(userId: string): Promise<UnreadCountDto> {
  const unreadCount = await db.notification.count({ where: { userId, readAt: null } });
  return { unreadCount };
}

/**
 * Idempotent mark-read: the guarded updateMany only touches rows the caller
 * owns AND only while still unread, so a repeated call never moves an
 * existing readAt. A zero count falls back to ONE ownership-pinned read to
 * distinguish "already read" (200, idempotent) from "not yours / not found"
 * (404 NOTIFICATION_NOT_FOUND).
 */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<{ notification: NotificationDto }> {
  const flipped = await db.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });

  if (flipped.count === 0) {
    const existing = await db.notification.findUnique({
      where: { id: notificationId },
      select: { ...NOTIFICATION_SELECT, userId: true },
    });
    // Ownership-pinned: another user's row reads as absent (no enumeration).
    if (!existing || existing.userId !== userId) {
      throw new ApiError(404, NOTIFICATION_NOT_FOUND, "The notification was not found.");
    }
    return { notification: toNotificationDto(existing) };
  }

  const row = await db.notification.findUnique({
    where: { id: notificationId },
    select: NOTIFICATION_SELECT,
  });
  if (!row) {
    // Practically unreachable (the row existed one statement ago); kept total.
    throw new ApiError(404, NOTIFICATION_NOT_FOUND, "The notification was not found.");
  }
  return { notification: toNotificationDto(row) };
}

/** Bulk mark-read scoped to the caller; returns the rows actually touched. */
export async function markAllNotificationsRead(userId: string): Promise<{ updatedCount: number }> {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updatedCount: result.count };
}
