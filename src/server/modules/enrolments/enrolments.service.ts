import { EnrolmentStatus, Prisma } from "@prisma/client";
import { FREE_PRICE_MINOR } from "@/contracts/catalog";
import {
  enrolmentListQuerySchema,
  type CourseEnrolmentStateDto,
  type EnrolmentDto,
  type PaginatedEnrolmentsDto,
} from "@/contracts/enrolments";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";
import { describeFreeEnrolmentEligibility } from "@/server/modules/enrolments/enrolments.logic";

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

function toEnrolmentDto(row: EnrolmentRow): EnrolmentDto {
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
  };
}

async function getCourseForEnrolment(slug: string) {
  const course = await db.course.findUnique({
    where: { slug },
    select: { id: true, title: true, status: true, priceMinor: true },
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
        ? "This course requires checkout. Paid enrolment is coming soon."
        : "This course is not open for enrolment.",
    );
  }

  const existing = await db.enrolment.findUnique({
    where: { userId_courseId: { userId, courseId: course.id } },
    select: ENROLMENT_WITH_COURSE_SELECT,
  });
  if (existing && existing.status !== EnrolmentStatus.REVOKED) {
    return toEnrolmentDto(existing);
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

  return toEnrolmentDto(enrolment);
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

  return {
    items: items.map(toEnrolmentDto),
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
        : null,
    total,
  };
}
