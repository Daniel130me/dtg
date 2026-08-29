import { CourseStatus, EnrolmentStatus, LessonStatus } from "@prisma/client";
import type { CourseProgressDto, ProgressResultDto } from "@/contracts/learning";
import { COURSE_NOT_ENROLLED, LESSON_NOT_FOUND } from "@/contracts/learning";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import {
  computeProgressPercent,
  pickNextLesson,
  shouldCompleteCourse,
} from "@/server/modules/learning/learning.logic";

// Authorization model: /api/v1/learning routes resolve the caller through
// requireAuthenticatedUser(headers); progress reads are keyed by that user id
// and writes validate an ACTIVE enrolment before touching LessonProgress.

/**
 * Per-course progress view for the learner classroom: the published
 * curriculum with a completion flag per lesson. Enrolment is NOT required —
 * the classroom also renders this view while previewing — but a non-enrolled
 * caller naturally sees zero progress because they have no completion rows.
 *
 * Query budget: 3 (course, sections+lessons, the caller's completion rows).
 */
export async function getCourseProgress(userId: string, slug: string): Promise<CourseProgressDto> {
  const course = await db.course.findUnique({
    where: { slug },
    select: { id: true, slug: true, title: true, status: true },
  });
  // Mirrors the catalog: draft/archived courses do not exist for learners.
  if (!course || course.status !== CourseStatus.PUBLISHED) {
    throw new ApiError(404, "COURSE_NOT_FOUND", "The requested course does not exist or is not published.");
  }

  const [sections, progressRows] = await Promise.all([
    db.courseSection.findMany({
      where: { courseId: course.id },
      orderBy: { position: "asc" },
      select: {
        id: true,
        title: true,
        position: true,
        lessons: {
          // A DRAFT lesson the owner is editing must not appear (or be
          // required) in the learner's curriculum.
          where: { status: LessonStatus.PUBLISHED },
          orderBy: { position: "asc" },
          select: { id: true, title: true, type: true, durationSeconds: true, isPreview: true },
        },
      },
    }),
    db.lessonProgress.findMany({
      where: { userId, courseId: course.id },
      select: { lessonId: true },
    }),
  ]);

  const completedIds = new Set(progressRows.map((row) => row.lessonId));
  const publishedLessons = sections.flatMap((section) => section.lessons);
  // Counting the intersection keeps the headline number consistent with the
  // rendered checklist: a completion row for a lesson the owner later
  // re-drafted must not inflate the percentage.
  const completedLessons = publishedLessons.filter((lesson) => completedIds.has(lesson.id)).length;
  const totalLessons = publishedLessons.length;

  return {
    course: { id: course.id, slug: course.slug, title: course.title },
    totalLessons,
    completedLessons,
    progressPercent: computeProgressPercent(completedLessons, totalLessons),
    nextLesson: pickNextLesson(publishedLessons, completedIds),
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      position: section.position,
      lessons: section.lessons.map((lesson) => ({
        ...lesson,
        completed: completedIds.has(lesson.id),
      })),
    })),
  };
}

/**
 * Monotonic lesson completion. Completion is recorded once per (user, lesson)
 * via the unique constraint; repeats resolve to the winning row and return
 * the same course snapshot (idempotent). When the final lesson flips the
 * course complete, the enrolment completes in the same transaction and an
 * exactly-once outbox event is emitted.
 *
 * Query budget: 2 reads (lesson, enrolment) + tx { create-or-read, 2 counts,
 * optional enrolment flip + outbox, optional audit }.
 */
export async function markLessonCompleted(
  userId: string,
  lessonId: string,
  requestId: string,
): Promise<ProgressResultDto> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, courseId: true, status: true },
  });
  if (!lesson || lesson.status !== LessonStatus.PUBLISHED) {
    throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");
  }

  const enrolment = await db.enrolment.findUnique({
    where: { userId_courseId: { userId, courseId: lesson.courseId } },
    select: { id: true, status: true },
  });
  if (!enrolment || enrolment.status !== EnrolmentStatus.ACTIVE) {
    throw new ApiError(422, COURSE_NOT_ENROLLED, "Enroll in the course to track progress.");
  }

  return withTransaction(async (tx) => {
    // Completion rows are unique per (user, lesson). A plain create inside the
    // transaction would abort the whole tx on a repeat (Postgres 25P02 makes
    // the follow-up read impossible), so the repeat is detected with a plain
    // pre-read and the write itself is an atomic upsert — concurrent duplicate
    // submits collapse onto one row instead of racing two inserts.
    const existing = await tx.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
      select: { id: true },
    });
    const progress = await tx.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId, courseId: lesson.courseId },
      // Monotonic: a repeat has nothing to update.
      update: {},
      select: { id: true },
    });
    // Only a true sub-millisecond race can see `existing === null` in two
    // transactions at once; the worst case is one duplicate audit row, never
    // duplicated progress.
    const firstCompletion = existing === null;
    const progressId = progress.id;

    // Totals are read after the insert so repeats observe the same numbers.
    // totalLessons counts PUBLISHED lessons only — draft lessons are never
    // required from a learner.
    const [totalLessons, completedLessons] = await Promise.all([
      tx.lesson.count({ where: { courseId: lesson.courseId, status: LessonStatus.PUBLISHED } }),
      tx.lessonProgress.count({ where: { userId, courseId: lesson.courseId } }),
    ]);
    const courseCompleted = shouldCompleteCourse(completedLessons, totalLessons);

    if (courseCompleted) {
      // The guarded updateMany is the concurrency gate: only the request that
      // actually flips completedAt from null proceeds (Postgres re-evaluates
      // the predicate after the row lock waits), so repeats and races cannot
      // double-fire the completion side effects.
      const completedAt = new Date();
      const flipped = await tx.enrolment.updateMany({
        where: { id: enrolment.id, completedAt: null },
        data: { status: EnrolmentStatus.COMPLETED, completedAt },
      });
      if (flipped.count === 1) {
        // Phase 9 (certificate eligibility) and Phase 10 (notifications)
        // consume the outbox. The unique eventKey makes the completion event
        // exactly-once even if a retry raced past the updateMany gate.
        await tx.outboxEvent.create({
          data: {
            eventKey: `course.completed:${enrolment.id}`,
            topic: "course.completed",
            aggregateType: "Enrolment",
            aggregateId: enrolment.id,
            payload: { userId, courseId: lesson.courseId, completedAt: completedAt.toISOString() },
          },
          select: { id: true },
        });
      }
    }

    // The audit trail records the completion transition; idempotent repeats
    // are deliberately not logged (they changed nothing).
    if (firstCompletion) {
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "lesson.completed",
          entityType: "LessonProgress",
          entityId: progressId,
          requestId,
          metadata: { courseId: lesson.courseId, lessonId },
        },
        select: { id: true },
      });
    }

    return {
      lessonId,
      completed: true,
      totalLessons,
      completedLessons,
      progressPercent: computeProgressPercent(completedLessons, totalLessons),
      courseCompleted,
    };
  });
}
