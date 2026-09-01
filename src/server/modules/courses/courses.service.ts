import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { CursorPage } from "@/contracts/api";
import type {
  OwnerCourseDetailDto,
  OwnerCourseLifecycleResult,
  OwnerCourseListItemDto,
} from "@/contracts/owner-courses";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";
import {
  toOwnerCourseDetailDto,
  toOwnerCourseListItemDto,
  collectPublishIssues,
  pickAvailableSlug,
  slugifyTitle,
  COURSE_VERSION_INCREMENT,
  type CourseDetailRow,
} from "@/server/modules/courses/courses.logic";
import type {
  CreateCourseInput,
  ListOwnerCoursesInput,
  UpdateCourseInput,
} from "@/server/modules/courses/courses.schemas";

// Authorization model: every /api/v1/owner route calls requireOwner(headers)
// before reaching this service. The single-owner platform invariant (exactly
// one OWNER user referenced by PlatformSettings.ownerUserId) makes that route
// check sufficient — any authenticated owner owns every course on the platform.

// Detail shape shared by getOwnerCourse and updateCourse: one include query
// returns the course with its full ordered curriculum and category.
const COURSE_DETAIL_INCLUDE = {
  sections: {
    orderBy: { position: "asc" },
    include: { lessons: { orderBy: { position: "asc" } } },
  },
  requirements: { orderBy: { position: "asc" } },
  outcomes: { orderBy: { position: "asc" } },
  category: true,
} satisfies Prisma.CourseInclude;

const OWNER_COURSE_LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  shortDescription: true,
  level: true,
  language: true,
  priceMinor: true,
  currency: true,
  status: true,
  version: true,
  totalSections: true,
  totalLessons: true,
  totalMinutes: true,
  enrollmentCount: true,
  ratingAverage: true,
  ratingCount: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.CourseSelect;

export async function createCourse(
  actorId: string,
  input: CreateCourseInput,
  requestId?: string,
): Promise<OwnerCourseDetailDto> {
  return withTransaction(async (transaction) => {
    // Query budget: 4 (category check, slug lookup, insert, audit).
    const category = await transaction.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (!category || category.status !== "ACTIVE") {
      throw new ApiError(422, "INVALID_CATEGORY", "The course category does not exist or is inactive.");
    }

    const baseSlug = slugifyTitle(input.slug ?? input.title);
    // One bounded query returns every slug sharing the base; the candidate
    // pick itself is pure (see pickAvailableSlug).
    const takenSlugs = await transaction.course.findMany({
      where: { slug: { startsWith: baseSlug } },
      select: { slug: true },
    });
    const slug = pickAvailableSlug(
      baseSlug,
      takenSlugs.map((row) => row.slug),
    );
    if (slug === null) {
      throw new ApiError(409, "SLUG_UNAVAILABLE", "No unique slug could be derived from this title.");
    }

    const courseId = randomUUID();
    const totalLessons = input.curriculum.reduce(
      (total, section) => total + section.lessons.length,
      0,
    );
    const totalDurationSeconds = input.curriculum.reduce(
      (courseTotal, section) =>
        courseTotal +
        section.lessons.reduce((sectionTotal, lesson) => sectionTotal + lesson.durationSeconds, 0),
      0,
    );

    const course = await transaction.course.create({
      data: {
        id: courseId,
        slug,
        title: input.title,
        shortDescription: input.shortDescription,
        description: input.description,
        promoVideoUrl: input.promoVideoUrl ?? null,
        categoryId: input.categoryId,
        creatorUserId: actorId,
        level: input.level,
        language: input.language,
        priceMinor: input.priceMinor,
        totalSections: input.curriculum.length,
        totalLessons,
        totalMinutes: Math.ceil(totalDurationSeconds / 60),
        sections: {
          create: input.curriculum.map((section, sectionIndex) => ({
            title: section.title,
            position: sectionIndex + 1,
            lessons: {
              create: section.lessons.map((lesson, lessonIndex) => ({
                courseId,
                title: lesson.title,
                type: lesson.type,
                position: lessonIndex + 1,
                durationSeconds: lesson.durationSeconds,
                isPreview: lesson.isPreview,
                content: lesson.content ?? null,
                videoUrl: lesson.videoUrl ?? null,
              })),
            },
          })),
        },
      },
      include: COURSE_DETAIL_INCLUDE,
    });

    await transaction.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "course.created",
        entityType: "Course",
        entityId: course.id,
        requestId,
        metadata: {
          slug: course.slug,
          sectionCount: input.curriculum.length,
          lessonCount: totalLessons,
        },
      },
      select: { id: true },
    });

    // Nested create + include returns the complete draft without a second read.
    return toOwnerCourseDetailDto(course as CourseDetailRow);
  });
}

// Query budget: 1 (single bounded list query).
export async function listOwnerCourses(
  filters: ListOwnerCoursesInput,
): Promise<CursorPage<OwnerCourseListItemDto>> {
  const where: Prisma.CourseWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    // Empty-string search params are treated as absent.
    ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" } } : {}),
  };

  // The (createdAt, id) pair is not a unique constraint, so the cursor is
  // applied as a manual where filter instead of Prisma's cursor option.
  if (filters.cursor) {
    const cursor = decodeCursor(filters.cursor);
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

  // One extra row detects whether a next page exists.
  const rows = await db.course.findMany({
    where,
    select: OWNER_COURSE_LIST_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: filters.limit + 1,
  });

  const hasMore = rows.length > filters.limit;
  const items = hasMore ? rows.slice(0, filters.limit) : rows;
  const lastItem = items.at(-1);

  return {
    items: items.map(toOwnerCourseListItemDto),
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
        : null,
  };
}

// Query budget: 1 (single include query covering sections, lessons,
// requirements, outcomes, and category).
export async function getOwnerCourse(
  courseId: string,
  expectedVersion?: number,
): Promise<OwnerCourseDetailDto> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: COURSE_DETAIL_INCLUDE,
  });
  if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");

  if (expectedVersion !== undefined && course.version !== expectedVersion) {
    throw new ApiError(409, "VERSION_CONFLICT", "The course was modified by another request.");
  }

  return toOwnerCourseDetailDto(course as CourseDetailRow);
}

// Query budget: 3-5 (load, optional category check, update, detail re-read,
// audit).
export async function updateCourse(
  actorId: string,
  courseId: string,
  input: UpdateCourseInput,
  requestId?: string,
): Promise<OwnerCourseDetailDto> {
  return withTransaction(async (transaction) => {
    const course = await transaction.course.findUnique({
      where: { id: courseId },
      select: { id: true, version: true },
    });
    if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");

    if (input.expectedVersion !== undefined && course.version !== input.expectedVersion) {
      throw new ApiError(409, "VERSION_CONFLICT", "The course was modified by another request.");
    }

    if (input.categoryId !== undefined) {
      const category = await transaction.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true, status: true },
      });
      if (!category || category.status !== "ACTIVE") {
        throw new ApiError(422, "INVALID_CATEGORY", "The course category does not exist or is inactive.");
      }
    }

    const { expectedVersion: _expectedVersion, ...fields } = input;
    await transaction.course.update({
      where: { id: courseId },
      data: { ...fields, version: { increment: COURSE_VERSION_INCREMENT } },
      select: { id: true },
    });

    await transaction.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "course.updated",
        entityType: "Course",
        entityId: courseId,
        requestId,
        metadata: { fields: Object.keys(fields) },
      },
      select: { id: true },
    });

    // Re-read inside the same transaction so the returned detail reflects the
    // bumped version and any counter changes.
    const updated = await transaction.course.findUnique({
      where: { id: courseId },
      include: COURSE_DETAIL_INCLUDE,
    });
    if (!updated) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");
    return toOwnerCourseDetailDto(updated as CourseDetailRow);
  });
}

// Query budget (inside tx): 4 (load with curriculum, update, lesson status
// bulk update, audit).
export async function publishCourse(
  actorId: string,
  courseId: string,
  requestId?: string,
): Promise<OwnerCourseLifecycleResult> {
  return withTransaction(async (transaction) => {
    const course = await transaction.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        title: true,
        shortDescription: true,
        description: true,
        categoryId: true,
        priceMinor: true,
        status: true,
        sections: {
          select: { id: true, title: true, _count: { select: { lessons: true } } },
        },
      },
    });
    if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");

    if (course.status === "PUBLISHED") {
      throw new ApiError(409, "COURSE_ALREADY_PUBLISHED", "The course is already published.");
    }

    const issues = collectPublishIssues({
      title: course.title,
      shortDescription: course.shortDescription,
      description: course.description,
      categoryId: course.categoryId,
      priceMinor: course.priceMinor,
      sections: course.sections.map((section) => ({
        id: section.id,
        title: section.title,
        lessonCount: section._count.lessons,
      })),
    });
    if (issues.length > 0) {
      throw new ApiError(
        422,
        "COURSE_NOT_PUBLISHABLE",
        "The course is missing required content before it can be published.",
        issues,
      );
    }

    const published = await transaction.course.update({
      where: { id: courseId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        version: { increment: COURSE_VERSION_INCREMENT },
      },
      select: { id: true, status: true, version: true, publishedAt: true },
    });

    // Publishing a course publishes every lesson it contains.
    await transaction.lesson.updateMany({
      where: { courseId },
      data: { status: "PUBLISHED" },
    });

    await transaction.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "course.published",
        entityType: "Course",
        entityId: courseId,
        requestId,
      },
      select: { id: true },
    });

    return {
      id: published.id,
      status: published.status,
      version: published.version,
      publishedAt: published.publishedAt?.toISOString() ?? null,
    };
  });
}

// Query budget (inside tx): 3 (load, update, audit). PUBLISHED → ARCHIVED.
export async function archiveCourse(
  actorId: string,
  courseId: string,
  requestId?: string,
): Promise<OwnerCourseLifecycleResult> {
  return withTransaction(async (transaction) => {
    const course = await transaction.course.findUnique({
      where: { id: courseId },
      select: { id: true, status: true },
    });
    if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");

    if (course.status !== "PUBLISHED") {
      throw new ApiError(409, "INVALID_STATUS_TRANSITION", "Only published courses can be archived.");
    }

    const archived = await transaction.course.update({
      where: { id: courseId },
      data: { status: "ARCHIVED", version: { increment: COURSE_VERSION_INCREMENT } },
      select: { id: true, status: true, version: true, publishedAt: true },
    });

    await transaction.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "course.archived",
        entityType: "Course",
        entityId: courseId,
        requestId,
      },
      select: { id: true },
    });

    return {
      id: archived.id,
      status: archived.status,
      version: archived.version,
      publishedAt: archived.publishedAt?.toISOString() ?? null,
    };
  });
}

// Query budget (inside tx): 3 (load, update, audit). ARCHIVED → DRAFT.
// publishedAt is cleared because a draft course is not a live offering; the
// next publish stamps a fresh date.
export async function unpublishCourse(
  actorId: string,
  courseId: string,
  requestId?: string,
): Promise<OwnerCourseLifecycleResult> {
  return withTransaction(async (transaction) => {
    const course = await transaction.course.findUnique({
      where: { id: courseId },
      select: { id: true, status: true },
    });
    if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");

    if (course.status !== "ARCHIVED") {
      throw new ApiError(409, "INVALID_STATUS_TRANSITION", "Only archived courses can be unpublished.");
    }

    const unpublished = await transaction.course.update({
      where: { id: courseId },
      data: {
        status: "DRAFT",
        publishedAt: null,
        version: { increment: COURSE_VERSION_INCREMENT },
      },
      select: { id: true, status: true, version: true, publishedAt: true },
    });

    await transaction.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "course.unpublished",
        entityType: "Course",
        entityId: courseId,
        requestId,
      },
      select: { id: true },
    });

    return {
      id: unpublished.id,
      status: unpublished.status,
      version: unpublished.version,
      publishedAt: null,
    };
  });
}

// Query budget (inside tx): 3 (load, delete, audit). Draft-only; sections and
// lessons are removed by cascading deletes.
export async function deleteCourse(
  actorId: string,
  courseId: string,
  requestId?: string,
): Promise<{ id: string }> {
  return withTransaction(async (transaction) => {
    const course = await transaction.course.findUnique({
      where: { id: courseId },
      select: { id: true, title: true, slug: true, status: true },
    });
    if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");

    if (course.status !== "DRAFT") {
      throw new ApiError(
        409,
        "COURSE_NOT_DRAFT",
        "Only draft courses can be deleted. Archive the course first.",
      );
    }

    await transaction.course.delete({ where: { id: courseId }, select: { id: true } });

    await transaction.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "course.deleted",
        entityType: "Course",
        entityId: courseId,
        requestId,
        metadata: { title: course.title, slug: course.slug },
      },
      select: { id: true },
    });

    return { id: courseId };
  });
}
