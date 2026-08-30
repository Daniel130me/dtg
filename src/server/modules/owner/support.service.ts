import { Prisma } from "@prisma/client";
import {
  type OwnerContactListQuery,
  type OwnerContactRowDto,
  type OwnerContactStatusBody,
  type PaginatedOwnerContactsDto,
} from "@/contracts/owner-ops";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";

// Authorization model: both functions are reached only after the route
// resolved the caller through requireOwner(headers) — the inbox is the owner
// console's view of every public contact submission, so no per-actor scoping
// applies. Rows purged by the support module's retention sweep read through
// unchanged: their message fields are already null in storage and the DTO
// carries them as nulls (the schema allows null for exactly this reason).

// Error code note: contracts/owner-ops.ts names client-matchable codes for
// students/exports; the inbox reuses the house naming style here
// (REVIEW_NOT_FOUND / CERTIFICATE_NOT_FOUND precedent) until it earns a
// contract slot.
const CONTACT_NOT_FOUND = "CONTACT_NOT_FOUND";

/** Shared (createdAt desc, id desc) keyset filter, house cursor style. */
function appendKeysetFilter(
  where: Prisma.ContactSubmissionWhereInput,
  cursorValue: string,
): void {
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

const CONTACT_ROW_SELECT = {
  id: true,
  name: true,
  email: true,
  subject: true,
  message: true,
  status: true,
  createdAt: true,
} satisfies Prisma.ContactSubmissionSelect;

type ContactRow = Prisma.ContactSubmissionGetPayload<{ select: typeof CONTACT_ROW_SELECT }>;

function toContactDto(row: ContactRow): OwnerContactRowDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Support inbox, newest first, optional NEW/ARCHIVED filter (rides the
 * (status, createdAt) index). Query budget: 2 (page, total).
 */
export async function listOwnerContactSubmissions(
  query: OwnerContactListQuery,
): Promise<PaginatedOwnerContactsDto> {
  const where: Prisma.ContactSubmissionWhereInput = {
    ...(query.status ? { status: query.status } : {}),
  };
  if (query.cursor) appendKeysetFilter(where, query.cursor);

  const [rows, total] = await Promise.all([
    db.contactSubmission.findMany({
      where,
      select: CONTACT_ROW_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    db.contactSubmission.count({ where }),
  ]);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = items.at(-1);

  return {
    items: items.map(toContactDto),
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
        : null,
    total,
  };
}

/**
 * Archive/unarchive a submission. The status write and its audit row move in
 * one transaction; NEW→NEW repeats are allowed and audited (the owner pressed
 * a privileged button — the trail records the intent, even when nothing
 * changed). Query budget: tx { read, update, audit }.
 */
export async function setOwnerContactStatus(
  actorId: string,
  submissionId: string,
  body: OwnerContactStatusBody,
  requestId: string,
): Promise<OwnerContactRowDto> {
  return withTransaction(async (tx) => {
    const existing = await tx.contactSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new ApiError(404, CONTACT_NOT_FOUND, "The contact submission was not found.");
    }

    const updated = await tx.contactSubmission.update({
      where: { id: existing.id },
      data: { status: body.status },
      select: CONTACT_ROW_SELECT,
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "support.contact.status_changed",
        entityType: "ContactSubmission",
        entityId: existing.id,
        requestId,
        metadata: { previousStatus: existing.status, newStatus: body.status },
      },
      select: { id: true },
    });

    return toContactDto(updated);
  });
}
