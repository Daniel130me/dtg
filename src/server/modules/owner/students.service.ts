import { Prisma, UserStatus, UserRole } from "@prisma/client";
import {
  OWNER_USER_NOT_FOUND,
  OWNER_USER_STATUS_FORBIDDEN,
  type OwnerStudentDetailDto,
  type OwnerStudentListQuery,
  type OwnerUserStatusBody,
  type OwnerUserStatusResult,
  type PaginatedOwnerStudentsDto,
} from "@/contracts/owner-ops";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";
import { computeProgressPercent } from "@/server/modules/learning/learning.logic";
import {
  evaluateUserStatusChange,
  USER_STATUS_AUDIT,
} from "@/server/modules/owner/students.logic";

// Authorization model: every function here is reached only after the route
// resolved the caller through requireOwner(headers), so the service trusts
// the actor's identity and never re-checks role. What it does enforce is the
// platform's own invariants: the OWNER account is not a learner, DELETED
// users read as absent everywhere, and no owner can suspend themselves or
// any OWNER-role account (see students.logic for the pure guard).
//
// Suspension semantics: suspending a learner deletes their sessions in the
// same transaction as the status flip (immediate logout — an auth-session
// read after the commit can never resurrect access), while reactivation
// touches nothing but the status column.

/** A missing id and a DELETED account read the same: absent (404). */
const OWNER_USER_ABSENT_ERROR = () =>
  new ApiError(404, OWNER_USER_NOT_FOUND, "The user was not found.");

/** The shared ORDER BY for owner keyset lists (newest first, id tiebreaker). */
const KEYSET_ORDER_BY = [{ createdAt: "desc" }, { id: "desc" }] as const;

/**
 * Learner scope for student management: role != OWNER (the owner account is
 * not a learner) and status != DELETED on the unfiltered path. An explicit
 * status filter can only ever ask for ACTIVE/SUSPENDED (contract enum), so
 * the not-DELETED guard is only needed when no filter narrows the status.
 */
function learnerWhere(query: OwnerStudentListQuery): Prisma.UserWhereInput {
  return {
    role: { not: UserRole.OWNER },
    status: query.status ?? { not: UserStatus.DELETED },
    ...(query.q
      ? {
          // Case-insensitive contains over display name OR the canonical
          // email column (emailNormalized is the lookup identity; `email`
          // is display copy kept in sync with it).
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { emailNormalized: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

/** Shared (createdAt desc, id desc) keyset filter, house cursor style. */
function appendKeysetFilter(where: Prisma.UserWhereInput, cursorValue: string): void {
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

// ---------------------------------------------------------------------------
// Student list (GET /owner/students)
// ---------------------------------------------------------------------------

/**
 * Owner student directory, newest first, cursor-paginated. The sort rides the
 * User @@index([status, createdAt, id]): with a status filter the whole
 * (filter + sort) is index-backed; without one Postgres sorts the (much
 * smaller than courses) user table — acceptable at launch scale and the same
 * (createdAt, id) keyset every other owner list uses, so cursors stay
 * interoperable with the shared encode/decode helpers.
 *
 * Query budget: 4 (page, total, enrolment groupBy for the page, last-activity
 * groupBy for the page) — the two aggregates are scoped to the page's ids, so
 * their cost is bounded by the page size, not the table.
 */
export async function listOwnerStudents(
  query: OwnerStudentListQuery,
): Promise<PaginatedOwnerStudentsDto> {
  const where = learnerWhere(query);
  // House counting semantics (reviews/grading/notifications): the total is
  // counted with the keyset predicate applied, i.e. it reports the rows from
  // the cursor onward — page 1 shows the full filtered total.
  if (query.cursor) appendKeysetFilter(where, query.cursor);

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      select: { id: true, name: true, email: true, status: true, createdAt: true },
      orderBy: [...KEYSET_ORDER_BY],
      take: query.limit + 1,
    }),
    db.user.count({ where }),
  ]);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = items.at(-1);
  const pageIds = items.map((row) => row.id);

  // Both aggregates are page-bounded reads; REVOKED enrolments stay counted
  // and progress stays counted from its rows: this surface is a management
  // record that labels reality (the detail view lists enrolments with their
  // REVOKED status too), unlike the analytics metrics which exclude REVOKED.
  const [enrolmentCounts, lastActivities] = await Promise.all([
    db.enrolment.groupBy({
      by: ["userId"],
      where: { userId: { in: pageIds } },
      _count: { _all: true },
    }),
    db.lessonProgress.groupBy({
      by: ["userId"],
      where: { userId: { in: pageIds } },
      _max: { completedAt: true },
    }),
  ]);
  const countByUser = new Map(enrolmentCounts.map((row) => [row.userId, row._count._all]));
  const activityByUser = new Map(
    lastActivities.map((row) => [row.userId, row._max.completedAt]),
  );

  return {
    items: items.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      enrolmentCount: countByUser.get(row.id) ?? 0,
      lastActivityAt: activityByUser.get(row.id)?.toISOString() ?? null,
    })),
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
        : null,
    total,
  };
}

// ---------------------------------------------------------------------------
// Student detail (GET /owner/students/{userId})
// ---------------------------------------------------------------------------

/**
 * One learner's full management record: account fields, every enrolment
 * (REVOKED labelled — the row schema allows it and the owner is the audit
 * surface), per-course completion counts, and the certificate count.
 *
 * Denominator choice (documented per the brief): the per-enrolment
 * `totalLessons` comes from the denormalized Course.totalLessons, the same
 * authoring-maintained counter the learner's own enrolment list uses as its
 * denominator — owner and learner always see the same percentage, and no
 * extra lesson scan is spent. It counts all lessons including drafts, which
 * computeProgressPercent clamps at 100.
 *
 * Query budget: 4 (user, enrolments+course, per-course progress groupBy,
 * certificate count) — the metrics doc's 3-read line predates the brief's
 * certificate-count requirement; the extra read is a PK-scoped count.
 */
export async function getOwnerStudent(userId: string): Promise<OwnerStudentDetailDto> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      role: true,
      emailVerified: true,
      createdAt: true,
    },
  });
  if (!user || user.status === UserStatus.DELETED) throw OWNER_USER_ABSENT_ERROR();

  const [enrolments, progressGroups, certificates] = await Promise.all([
    db.enrolment.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        source: true,
        createdAt: true,
        completedAt: true,
        course: { select: { id: true, slug: true, title: true, totalLessons: true } },
      },
      orderBy: [...KEYSET_ORDER_BY],
    }),
    // One grouped read covers both aggregates: per-course completed counts
    // AND the account-level last-activity max (max over the group maxima).
    db.lessonProgress.groupBy({
      by: ["courseId"],
      where: { userId },
      _count: { _all: true },
      _max: { completedAt: true },
    }),
    db.certificate.count({ where: { userId } }),
  ]);

  const completedByCourse = new Map(
    progressGroups.map((group) => [group.courseId, group._count._all]),
  );
  const activityByCourse = new Map(
    progressGroups.map((group) => [group.courseId, group._max.completedAt]),
  );
  const accountLastActivity = progressGroups.reduce<Date | null>(
    (latest, group) =>
      group._max.completedAt !== null &&
      (latest === null || group._max.completedAt > latest)
        ? group._max.completedAt
        : latest,
    null,
  );

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
    lastActivityAt: accountLastActivity?.toISOString() ?? null,
    certificates,
    enrolments: enrolments.map((enrolment) => {
      const completedLessons = completedByCourse.get(enrolment.course.id) ?? 0;
      return {
        enrolmentId: enrolment.id,
        courseId: enrolment.course.id,
        courseTitle: enrolment.course.title,
        courseSlug: enrolment.course.slug,
        status: enrolment.status,
        source: enrolment.source,
        totalLessons: enrolment.course.totalLessons,
        completedLessons,
        progressPercent: computeProgressPercent(
          completedLessons,
          enrolment.course.totalLessons,
        ),
        enrolledAt: enrolment.createdAt.toISOString(),
        completedAt: enrolment.completedAt?.toISOString() ?? null,
        lastActivityAt: activityByCourse.get(enrolment.course.id)?.toISOString() ?? null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// User status (POST /owner/users/{userId}/status)
// ---------------------------------------------------------------------------

/**
 * Flips a learner between ACTIVE and SUSPENDED. Serializable on purpose: the
 * guard and the write must be atomic — an owner transfer concurrently
 * flipping the target's role to OWNER must not slip past the OWNER guard.
 *
 * No-op repeats (ACTIVE→ACTIVE, SUSPENDED→SUSPENDED) return success with
 * sessionsRevoked 0 and write nothing — there is no privileged state change
 * to audit. A real suspension deletes the target's sessions inside the same
 * transaction (the returned count is part of the audited mutation).
 *
 * Query budget: tx { target read, optional session deleteMany, user update,
 * audit } (1 read + up to 3 writes, all in one transaction).
 */
export async function setOwnerUserStatus(
  actorId: string,
  userId: string,
  body: OwnerUserStatusBody,
  requestId: string,
): Promise<OwnerUserStatusResult> {
  return withTransaction(
    async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, status: true },
      });
      if (!target) throw OWNER_USER_ABSENT_ERROR();

      const decision = evaluateUserStatusChange(actorId, target, body.status);
      if (!decision.ok) {
        // The guard re-encodes absence for the pure model; on this path a
        // DELETED target can only appear if the row vanished between the
        // read and the guard, and it still maps to the same 404.
        if (decision.code === OWNER_USER_NOT_FOUND) throw OWNER_USER_ABSENT_ERROR();
        throw new ApiError(
          422,
          OWNER_USER_STATUS_FORBIDDEN,
          "This account cannot be status-managed.",
        );
      }
      if (decision.noop) {
        return { id: target.id, status: body.status, sessionsRevoked: 0 };
      }

      const suspending = body.status === "SUSPENDED";
      const sessionsRevoked = suspending
        ? (await tx.session.deleteMany({ where: { userId: target.id } })).count
        : 0;

      await tx.user.update({
        where: { id: target.id },
        data: { status: body.status },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actorId,
          action: suspending ? USER_STATUS_AUDIT.suspended : USER_STATUS_AUDIT.reactivated,
          entityType: "User",
          entityId: target.id,
          requestId,
          metadata: { actorId, previousStatus: target.status },
        },
        select: { id: true },
      });

      return { id: target.id, status: body.status, sessionsRevoked };
    },
    // Serializable mirrors owner.service's ownership-critical transactions.
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
