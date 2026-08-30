import { EnrolmentStatus, Prisma } from "@prisma/client";
import { FREE_PRICE_MINOR } from "@/contracts/catalog";
import {
  enrolmentListQuerySchema,
  type CourseEnrolmentStateDto,
  type EnrolmentDto,
  type EnrolmentProgressDto,
  type PaginatedEnrolmentsDto,
} from "@/contracts/enrolments";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";
import { describeFreeEnrolmentEligibility } from "@/server/modules/enrolments/enrolments.logic";
import { computeProgressPercent } from "@/server/modules/learning/learning.logic";

// Authorization model: /api/v1/learning routes resolve the caller through
// requireAuthenticatedUser(headers) and every query is pinned to that user id,
// so a learner can only ever read their own enrolments.

// One include query returns the enrolment with the course summary the
// my-learning cards need; lesson bodies are intentionally not loaded here.
const ENROLMENT_WITH_COURSE_SELECT = {
  id: true,
  courseId: true,
  status: true,
  source: true,
  completedAt: true,
  revokedAt: true,
  createdAt: true,
  course: {
    select: {
      id: true,
      slug: true,
      title: true,
      shortDescription: true,
      level: true,
      language: true,
      thumbnailUrl: true,
      totalLessons: true,
      totalMinutes: true,
      category: { select: { name: true, slug: true } },
    },
  },
} satisfies Prisma.EnrolmentSelect;

type EnrolmentRow = Prisma.EnrolmentGetPayload<{ select: typeof ENROLMENT_WITH_COURSE_SELECT }>;

function toEnrolmentDto(row: EnrolmentRow, completedLessons: number | null): EnrolmentDto {
  return {
    id: row.id,
    courseId: row.courseId,
    status: row.status,
    source: row.source,
    enrolledAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    course: {
      id: row.course.id,
      slug: row.course.slug,
      title: row.course.title,
      shortDescription: row.course.shortDescription,
      level: row.course.level,
      language: row.course.language,
      thumbnailUrl: row.course.thumbnailUrl,
      totalLessons: row.course.totalLessons,
      totalMinutes: row.course.totalMinutes,
      categoryName: row.course.category.name,
      categorySlug: row.course.category.slug,
    },
    progress: toEnrolmentProgress(row, completedLessons),
  };
}

/**
 * Phase 8 read-model extension: ACTIVE/COMPLETED enrolments carry a progress
 * block computed from ONE grouped LessonProgress count; REVOKED enrolments no
 * longer represent a learning journey, so theirs is null. The denominator is
 * the already-selected denormalized course.totalLessons (no extra query).
 */
function toEnrolmentProgress(
  row: EnrolmentRow,
  completedLessons: number | null,
): EnrolmentProgressDto | null {
  if (completedLessons === null) return null;
  return {
    completedLessons,
    totalLessons: row.course.totalLessons,
    progressPercent: computeProgressPercent(completedLessons, row.course.totalLessons),
  };
}

async function getCourseForEnrolment(slug: string) {
  const course = await db.course.findUnique({
    where: { slug },
    // slug is carried for the enrolment.confirmed outbox payload (the
    // notification needs the classroom deep link).
    select: { id: true, title: true, slug: true, status: true, priceMinor: true },
  });
  if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The requested course does not exist.");
  return course;
}

/**
 * Idempotent free-course enrolment.
 *
 * The (userId, courseId) unique constraint is the concurrency guarantee: a
 * duplicate submit either finds the existing row up front or loses the insert
 * race and falls back to reading the winner. Re-enrolling a REVOKED enrolment
 * reactivates it instead of creating a second row. The denormalized
 * Course.enrollmentCount only ever increments on first-time enrolment.
 */
export async function enrollInFreeCourse(userId: string, slug: string, requestId: string): Promise<EnrolmentDto> {
  const course = await getCourseForEnrolment(slug);
  const eligibility = describeFreeEnrolmentEligibility({
    status: course.status,
    priceMinor: course.priceMinor,
    freePriceMinor: FREE_PRICE_MINOR,
  });
  if (!eligibility.eligible) {
    throw new ApiError(
      422,
      eligibility.blocker!,
      eligibility.blocker === "PAID_COURSE_REQUIRES_CHECKOUT"
        ? "This course requires checkout to enroll."
        : "This course is not open for enrolment.",
    );
  }

  const existing = await db.enrolment.findUnique({
    where: { userId_courseId: { userId, courseId: course.id } },
    select: ENROLMENT_WITH_COURSE_SELECT,
  });
  if (existing && existing.status !== EnrolmentStatus.REVOKED) {
    return toEnrolmentDto(existing, await countCompletedLessons(userId, course.id));
  }

  const enrolment = await withTransaction(async (tx) => {
    if (existing) {
      const reactivated = await tx.enrolment.update({
        where: { id: existing.id },
        data: { status: EnrolmentStatus.ACTIVE, revokedAt: null },
        select: ENROLMENT_WITH_COURSE_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "enrolment.reactivated",
          entityType: "Enrolment",
          entityId: existing.id,
          requestId,
          metadata: { courseId: course.id },
        },
        select: { id: true },
      });
      return reactivated;
    }

    const created = await tx.enrolment
      .create({
        data: { userId, courseId: course.id, source: "FREE", status: EnrolmentStatus.ACTIVE },
        select: ENROLMENT_WITH_COURSE_SELECT,
      })
      .catch(async (error: unknown) => {
        // Lost an insert race against a concurrent duplicate submit: fall back
        // to the winning row so the request stays idempotent (200, not 409).
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const winner = await tx.enrolment.findUnique({
            where: { userId_courseId: { userId, courseId: course.id } },
            select: ENROLMENT_WITH_COURSE_SELECT,
          });
          if (winner) return winner;
        }
        throw error;
      });
    await tx.course.update({
      where: { id: course.id },
      data: { enrollmentCount: { increment: 1 } },
      select: { id: true },
    });

    // Phase 10: the enrolment confirmation notification + email are projected
    // from the outbox by the notifications dispatcher instead of being sent
    // inline, so enrolment writes never wait on SMTP. The unique eventKey
    // keeps a retried request from duplicating the projection.
    await tx.outboxEvent.create({
      data: {
        eventKey: `enrolment.confirmed:${created.id}`,
        topic: "enrolment.confirmed",
        aggregateType: "Enrolment",
        aggregateId: created.id,
        payload: {
          enrolmentId: created.id,
          userId,
          courseId: course.id,
          courseTitle: course.title,
          courseSlug: course.slug,
        },
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "enrolment.created",
        entityType: "Enrolment",
        entityId: created.id,
        requestId,
        metadata: { courseId: course.id, source: "FREE" },
      },
      select: { id: true },
    });
    return created;
  });

  // One count decorates the enrolment response with the progress block.
  return toEnrolmentDto(enrolment, await countCompletedLessons(userId, course.id));
}

function countCompletedLessons(userId: string, courseId: string): Promise<number> {
  return db.lessonProgress.count({ where: { userId, courseId } });
}

/**
 * Lightweight CTA state probe for the course detail page: one query resolves
 * course existence and the caller's enrolment status together.
 */
export async function getCourseEnrolmentState(userId: string, slug: string): Promise<CourseEnrolmentStateDto> {
  const course = await db.course.findUnique({
    where: { slug },
    select: { enrolments: { where: { userId }, select: { status: true }, take: 1 } },
  });
  if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The requested course does not exist.");

  const status = course.enrolments[0]?.status ?? null;
  return {
    // A revoked learner has no access, so the CTA must treat them as unenrolled.
    enrolled: status !== null && status !== EnrolmentStatus.REVOKED,
    status,
  };
}

/**
 * My-learning read model: keyset pagination over (createdAt, id) so paging
 * stays exact and cheap. Two queries total (page + total) regardless of depth.
 */
export async function listMyEnrolments(userId: string, input: unknown): Promise<PaginatedEnrolmentsDto> {
  const query = enrolmentListQuerySchema.parse(input);

  const where: Prisma.EnrolmentWhereInput = {
    userId,
    ...(query.status ? { status: query.status } : {}),
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

  const [rows, total] = await Promise.all([
    db.enrolment.findMany({
      where,
      select: ENROLMENT_WITH_COURSE_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    db.enrolment.count({ where: { userId, ...(query.status ? { status: query.status } : {}) } }),
  ]);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = items.at(-1);

  // One grouped query decorates the page with per-course completion counts
  // (totalLessons comes from the already-selected course summary), keeping
  // the whole read model at 3 queries: page + total + progress groupBy.
  const pageCourseIds = [...new Set(items.map((item) => item.courseId))];
  const progressCounts = pageCourseIds.length
    ? await db.lessonProgress.groupBy({
        by: ["courseId"],
        where: { userId, courseId: { in: pageCourseIds } },
        _count: { _all: true },
      })
    : [];
  const completedByCourse = new Map(progressCounts.map((row) => [row.courseId, row._count._all]));

  return {
    items: items.map((row) =>
      toEnrolmentDto(
        row,
        // REVOKED enrolments carry no progress block (null completedLessons).
        row.status === EnrolmentStatus.REVOKED ? null : completedByCourse.get(row.courseId) ?? 0,
      ),
    ),
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
        : null,
    total,
  };
}
