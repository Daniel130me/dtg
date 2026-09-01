import type { Prisma } from "@prisma/client";
import type { TransactionClient } from "@/server/db/transaction";
import { withTransaction } from "@/server/db/transaction";
import type {
  OwnerChildDeletedResult,
  OwnerLessonMutationResult,
  OwnerSectionMutationResult,
  OwnerSectionReorderResult,
} from "@/contracts/owner-courses";
import { ApiError } from "@/server/http/errors";
import { logger } from "@/server/observability/logger";
import { deleteObject, deleteObjects } from "@/server/storage/r2";
import {
  clampInsertPosition,
  reorderedSectionPositions,
  toOwnerLessonDto,
  toOwnerSectionDto,
  COURSE_VERSION_INCREMENT,
  SECONDS_PER_MINUTE,
} from "@/server/modules/courses/courses.logic";
import type {
  LessonCreateInput,
  LessonUpdateInput,
  MoveLessonInput,
  SectionCreateInput,
  SectionUpdateInput,
} from "@/server/modules/courses/courses.schemas";

// Authorization model: /api/v1/owner routes call requireOwner(headers) before
// reaching this service; the single-owner platform invariant makes that check
// sufficient for all curriculum mutations.

// During section reordering every section is shifted by this constant so all
// positions become distinct negative values; final 1..n positions are then
// written back without tripping unique(courseId, position). Larger than any
// realistic section count.
const SECTION_POSITION_OFFSET = 1_000_000;
// Parked position for a lesson being moved: positions are always >= 1, so 0
// never collides while surrounding rows are renumbered.
const TEMP_LESSON_POSITION = 0;

// Single aggregate per course per mutation keeps the denormalized counters
// exact (no N+1): totalLessons from the row count, totalMinutes rounded up so
// partial minutes still count.
async function recomputeCourseLessonCounters(transaction: TransactionClient, courseId: string) {
  const aggregate = await transaction.lesson.aggregate({
    where: { courseId },
    _count: { _all: true },
    _sum: { durationSeconds: true },
  });
  return {
    totalLessons: aggregate._count._all,
    totalMinutes: Math.ceil((aggregate._sum.durationSeconds ?? 0) / SECONDS_PER_MINUTE),
  };
}

async function loadSection(transaction: TransactionClient, sectionId: string) {
  const section = await transaction.courseSection.findUnique({
    where: { id: sectionId },
    select: { id: true, courseId: true },
  });
  if (!section) throw new ApiError(404, "SECTION_NOT_FOUND", "The section was not found.");
  return section;
}

// Query budget (inside tx): 4 (course check, max position, insert, course
// counter bump).
export async function createSection(
  courseId: string,
  input: SectionCreateInput,
): Promise<OwnerSectionMutationResult> {
  return withTransaction(async (transaction) => {
    const course = await transaction.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");

    const maxPosition = await transaction.courseSection.aggregate({
      where: { courseId },
      _max: { position: true },
    });

    const section = await transaction.courseSection.create({
      data: {
        courseId,
        title: input.title,
        position: (maxPosition._max.position ?? 0) + 1,
      },
    });

    const updatedCourse = await transaction.course.update({
      where: { id: courseId },
      data: {
        totalSections: { increment: 1 },
        version: { increment: COURSE_VERSION_INCREMENT },
      },
      select: { version: true },
    });

    return {
      section: toOwnerSectionDto({ ...section, lessons: [] }),
      courseVersion: updatedCourse.version,
    };
  });
}

// Query budget (inside tx): 4 (section, optional version check, update,
// course version bump).
export async function renameSection(
  sectionId: string,
  input: SectionUpdateInput,
): Promise<OwnerSectionMutationResult> {
  return withTransaction(async (transaction) => {
    const section = await loadSection(transaction, sectionId);

    if (input.expectedVersion !== undefined) {
      const course = await transaction.course.findUnique({
        where: { id: section.courseId },
        select: { version: true },
      });
      if (!course) throw new ApiError(404, "COURSE_NOT_FOUND", "The course was not found.");
      if (course.version !== input.expectedVersion) {
        throw new ApiError(409, "VERSION_CONFLICT", "The course was modified by another request.");
      }
    }

    const { expectedVersion: _expectedVersion, ...fields } = input;
    const updatedSection = await transaction.courseSection.update({
      where: { id: sectionId },
      data: fields,
    });

    const updatedCourse = await transaction.course.update({
      where: { id: section.courseId },
      data: { version: { increment: COURSE_VERSION_INCREMENT } },
      select: { version: true },
    });

    return {
      section: toOwnerSectionDto({ ...updatedSection, lessons: [] }),
      courseVersion: updatedCourse.version,
    };
  });
}

// Query budget (inside tx): 5 (section, media keys, delete, lesson aggregate,
// course counter update). Deleting the section cascades its lessons.
export async function deleteSection(sectionId: string): Promise<OwnerChildDeletedResult> {
  const result = await withTransaction(async (transaction) => {
    const section = await loadSection(transaction, sectionId);
    const media = await transaction.lesson.findMany({
      where: { sectionId, videoKey: { not: null } },
      select: { videoKey: true },
    });

    await transaction.courseSection.delete({ where: { id: sectionId }, select: { id: true } });

    const counters = await recomputeCourseLessonCounters(transaction, section.courseId);
    const updatedCourse = await transaction.course.update({
      where: { id: section.courseId },
      data: {
        totalSections: { decrement: 1 },
        totalLessons: counters.totalLessons,
        totalMinutes: counters.totalMinutes,
        version: { increment: COURSE_VERSION_INCREMENT },
      },
      select: { version: true },
    });

    return {
      response: { courseId: section.courseId, courseVersion: updatedCourse.version },
      removedVideoKeys: media.flatMap((item) => (item.videoKey ? [item.videoKey] : [])),
    };
  });

  await deleteObjects(result.removedVideoKeys).catch((error: unknown) => {
    logger.warn("Deleted section videos could not be removed", { sectionId, error });
  });
  return result.response;
}

// Query budget (inside tx): 2 + n (section load, sibling list, offset write,
// n bounded position writes, course version bump). All position writes happen
// after a single offset update moves every section into the negative range,
// so unique(courseId, position) is never violated mid-reorder.
export async function reorderSection(
  sectionId: string,
  requestedPosition: number,
): Promise<OwnerSectionReorderResult> {
  return withTransaction(async (transaction) => {
    const section = await loadSection(transaction, sectionId);

    const siblings = await transaction.courseSection.findMany({
      where: { courseId: section.courseId },
      select: { id: true, position: true },
      orderBy: { position: "asc" },
    });

    const finalOrder = reorderedSectionPositions(siblings, sectionId, requestedPosition);

    await transaction.courseSection.updateMany({
      where: { courseId: section.courseId },
      data: { position: { increment: -SECTION_POSITION_OFFSET } },
    });
    for (const item of finalOrder) {
      await transaction.courseSection.update({
        where: { id: item.id },
        data: { position: item.position },
        select: { id: true },
      });
    }

    const updatedCourse = await transaction.course.update({
      where: { id: section.courseId },
      data: { version: { increment: COURSE_VERSION_INCREMENT } },
      select: { version: true },
    });

    return {
      courseId: section.courseId,
      courseVersion: updatedCourse.version,
      sections: finalOrder,
    };
  });
}

// Query budget (inside tx): 5 (section, max position, insert, lesson
// aggregate, course counter update).
export async function createLesson(
  sectionId: string,
  input: LessonCreateInput,
): Promise<OwnerLessonMutationResult> {
  return withTransaction(async (transaction) => {
    const section = await loadSection(transaction, sectionId);

    const maxPosition = await transaction.lesson.aggregate({
      where: { sectionId },
      _max: { position: true },
    });

    const lesson = await transaction.lesson.create({
      data: {
        sectionId,
        courseId: section.courseId,
        title: input.title,
        type: input.type,
        durationSeconds: input.durationSeconds,
        isPreview: input.isPreview,
        content: input.content ?? null,
        videoUrl: input.videoUrl ?? null,
        position: (maxPosition._max.position ?? 0) + 1,
      },
    });

    const counters = await recomputeCourseLessonCounters(transaction, section.courseId);
    const updatedCourse = await transaction.course.update({
      where: { id: section.courseId },
      data: {
        totalLessons: counters.totalLessons,
        totalMinutes: counters.totalMinutes,
        version: { increment: COURSE_VERSION_INCREMENT },
      },
      select: { version: true },
    });

    return { lesson: toOwnerLessonDto(lesson), courseVersion: updatedCourse.version };
  });
}

// Query budget (inside tx): 3-4 (lesson, update, optional aggregate, course
// counter update). Counters only need recomputation when a duration changed.
export async function updateLesson(
  lessonId: string,
  input: LessonUpdateInput,
): Promise<OwnerLessonMutationResult> {
  const result = await withTransaction(async (transaction) => {
    const lesson = await transaction.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        sectionId: true,
        courseId: true,
        durationSeconds: true,
        videoKey: true,
      },
    });
    if (!lesson) throw new ApiError(404, "LESSON_NOT_FOUND", "The lesson was not found.");

    const { content, videoUrl, ...fields } = input;
    const clearsUploadedVideo =
      (input.type !== undefined && input.type !== "VIDEO") || typeof videoUrl === "string";
    const data: Prisma.LessonUncheckedUpdateInput = {
      ...fields,
      ...(content !== undefined ? { content } : {}),
      ...(videoUrl !== undefined ? { videoUrl } : {}),
      ...(clearsUploadedVideo
        ? {
            videoKey: null,
            videoFileName: null,
            videoContentType: null,
            videoSizeBytes: null,
            videoUploadedAt: null,
          }
        : {}),
    };

    const updatedLesson = await transaction.lesson.update({
      where: { id: lessonId },
      data,
    });

    const durationChanged =
      input.durationSeconds !== undefined && input.durationSeconds !== lesson.durationSeconds;
    const courseData: Prisma.CourseUncheckedUpdateInput = {
      version: { increment: COURSE_VERSION_INCREMENT },
    };
    if (durationChanged) {
      const counters = await recomputeCourseLessonCounters(transaction, lesson.courseId);
      courseData.totalLessons = counters.totalLessons;
      courseData.totalMinutes = counters.totalMinutes;
    }
    const updatedCourse = await transaction.course.update({
      where: { id: lesson.courseId },
      data: courseData,
      select: { version: true },
    });

    return {
      response: { lesson: toOwnerLessonDto(updatedLesson), courseVersion: updatedCourse.version },
      removedVideoKey: clearsUploadedVideo ? lesson.videoKey : null,
    };
  });

  if (result.removedVideoKey) {
    deleteObject(result.removedVideoKey).catch((error: unknown) => {
      logger.warn("Removed lesson video could not be deleted", {
        lessonId,
        objectKey: result.removedVideoKey,
        error,
      });
    });
  }
  return result.response;
}

// Query budget (inside tx): 5 (lesson, delete, position renumber, lesson
// aggregate, course counter update). Deleting first frees the position, so a
// single decrement renumbers the remaining lessons.
export async function deleteLesson(lessonId: string): Promise<OwnerChildDeletedResult> {
  const result = await withTransaction(async (transaction) => {
    const lesson = await transaction.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, sectionId: true, courseId: true, position: true, videoKey: true },
    });
    if (!lesson) throw new ApiError(404, "LESSON_NOT_FOUND", "The lesson was not found.");

    await transaction.lesson.delete({ where: { id: lessonId }, select: { id: true } });

    await transaction.lesson.updateMany({
      where: { sectionId: lesson.sectionId, position: { gt: lesson.position } },
      data: { position: { decrement: 1 } },
    });

    const counters = await recomputeCourseLessonCounters(transaction, lesson.courseId);
    const updatedCourse = await transaction.course.update({
      where: { id: lesson.courseId },
      data: {
        totalLessons: counters.totalLessons,
        totalMinutes: counters.totalMinutes,
        version: { increment: COURSE_VERSION_INCREMENT },
      },
      select: { version: true },
    });

    return {
      response: { courseId: lesson.courseId, courseVersion: updatedCourse.version },
      removedVideoKey: lesson.videoKey,
    };
  });

  if (result.removedVideoKey) {
    deleteObject(result.removedVideoKey).catch((error: unknown) => {
      logger.warn("Deleted lesson video could not be removed", {
        lessonId,
        objectKey: result.removedVideoKey,
        error,
      });
    });
  }
  return result.response;
}

// Query budget (inside tx): 8 (lesson, target section, park lesson, old
// section renumber, new section shift, final lesson write, lesson aggregate,
// course counter update) — all within one transaction.
export async function moveLesson(
  lessonId: string,
  input: MoveLessonInput,
): Promise<OwnerLessonMutationResult> {
  return withTransaction(async (transaction) => {
    const lesson = await transaction.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, sectionId: true, courseId: true, position: true },
    });
    if (!lesson) throw new ApiError(404, "LESSON_NOT_FOUND", "The lesson was not found.");

    const targetSection = await transaction.courseSection.findUnique({
      where: { id: input.sectionId },
      select: { id: true, courseId: true, _count: { select: { lessons: true } } },
    });
    if (!targetSection) {
      throw new ApiError(404, "SECTION_NOT_FOUND", "The target section was not found.");
    }
    if (targetSection.courseId !== lesson.courseId) {
      throw new ApiError(
        422,
        "LESSON_SECTION_MISMATCH",
        "The target section belongs to a different course.",
      );
    }

    const sameSection = targetSection.id === lesson.sectionId;
    // Other lessons present in the target layout (the moving lesson excluded
    // when it already lives there) determine the valid position range.
    const otherLessonCount =
      targetSection._count.lessons - (sameSection ? 1 : 0);
    const insertPosition = clampInsertPosition(input.position, otherLessonCount);

    // Park the lesson outside the positive position range so renumbering the
    // source/target sections cannot collide with it.
    await transaction.lesson.update({
      where: { id: lessonId },
      data: { position: TEMP_LESSON_POSITION },
      select: { id: true },
    });

    await transaction.lesson.updateMany({
      where: { sectionId: lesson.sectionId, position: { gt: lesson.position } },
      data: { position: { decrement: 1 } },
    });

    await transaction.lesson.updateMany({
      where: { sectionId: targetSection.id, position: { gte: insertPosition } },
      data: { position: { increment: 1 } },
    });

    const movedLesson = await transaction.lesson.update({
      where: { id: lessonId },
      data: { sectionId: targetSection.id, position: insertPosition },
    });

    // A move cannot change lesson count or total duration, but the counters
    // are recomputed once anyway to keep them authoritative.
    const counters = await recomputeCourseLessonCounters(transaction, lesson.courseId);
    const updatedCourse = await transaction.course.update({
      where: { id: lesson.courseId },
      data: {
        totalLessons: counters.totalLessons,
        totalMinutes: counters.totalMinutes,
        version: { increment: COURSE_VERSION_INCREMENT },
      },
      select: { version: true },
    });

    return { lesson: toOwnerLessonDto(movedLesson), courseVersion: updatedCourse.version };
  });
}
