import { Prisma } from "@prisma/client";
import {
  type OwnerAuditQuery,
  type PaginatedOwnerAuditDto,
} from "@/contracts/owner-ops";
import { db } from "@/server/db/client";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";

// Authorization model: read-only owner surface, reached only through
// requireOwner(headers) at the route. The audit log is append-only (no write
// path exists in this module); this service only makes the trail browsable.

/** Shared (createdAt desc, id desc) keyset filter, house cursor style. */
function appendKeysetFilter(where: Prisma.AuditLogWhereInput, cursorValue: string): void {
  const cursor = decodeCursor(cursorValue);
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

/**
 * Audit trail lookup, newest first. Optional filters: exact actorId (rides
 * the (actorUserId, createdAt, id) index) and case-insensitive `contains` on
 * the action verb (unindexed, but action strings are short and the audit
 * table grows at privileged-mutation rate, not request rate). Query budget:
 * 2 (page, total).
 */
export async function listOwnerAudit(query: OwnerAuditQuery): Promise<PaginatedOwnerAuditDto> {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorUserId: query.actorId } : {}),
    ...(query.action
      ? { action: { contains: query.action, mode: "insensitive" } }
      : {}),
  };
  if (query.cursor) appendKeysetFilter(where, query.cursor);

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        actor: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    db.auditLog.count({ where }),
  ]);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = items.at(-1);

  return {
    items: items.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      // System/anonymous rows (e.g. contact submissions) carry no actor.
      actor: row.actor ? { id: row.actor.id, name: row.actor.name } : null,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
        : null,
    total,
  };
}
