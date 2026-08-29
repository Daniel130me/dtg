import { EnrolmentStatus, LessonStatus } from "@prisma/client";
import type {
  ContinueLearningCardDto,
  LearnerDashboardDto,
  LessonSummaryDto,
} from "@/contracts/learning";
import { CONTINUE_LEARNING_LIMIT } from "@/contracts/learning";
import { db } from "@/server/db/client";
import {
  compareCurriculumOrder,
  computeProgressPercent,
  pickContinueLearningCourses,
  pickNextLesson,
} from "@/server/modules/learning/learning.logic";
import { SECONDS_PER_MINUTE } from "@/server/modules/courses/courses.logic";

// Authorization model: /api/v1/learning routes resolve the caller through
// requireAuthenticatedUser(headers) and every query is pinned to that user id,
// so a learner can only ever read their own dashboard.

/**
 * Learner dashboard read model.
 *
 * Query budget: 5 reads, all bounded by the learner's own rows.
 * 1. enrolment counts grouped by status (stat tiles);
 * 2. ACTIVE enrolments (course ids + enrolment dates for card ordering);
 * 3. every LessonProgress row of the learner (bounded by the lessons they
 *    actually completed) — drives the global stats AND the per-course
 *    completed sets / last-activity stamps in a single read;
 * 4. course summaries for the picked "continue learning" courses (≤ limit);
 * 5. published lessons of those courses for next-lesson choice.
 */
export async function getLearnerDashboard(userId: string): Promise<LearnerDashboardDto> {
  const [enrolmentCounts, activeEnrolments, progressRows] = await Promise.all([
    // (1) Stat tiles: enrolled = ACTIVE, completed = COMPLETED.
    db.enrolment.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
    }),
    // (2) Card candidates, bounded by the user's own enrolments.
    db.enrolment.findMany({
      where: { userId, status: EnrolmentStatus.ACTIVE },
      select: { courseId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    // (3) One read powering lessonsCompleted, minutesCompleted and the
    // per-course completed sets used for next-lesson selection.
    db.lessonProgress.findMany({
      where: { userId },
      select: {
        courseId: true,
        lessonId: true,
        completedAt: true,
        lesson: { select: { durationSeconds: true } },
      },
    }),
  ]);

  const countFor = (status: EnrolmentStatus) =>
    enrolmentCounts.find((row) => row.status === status)?._count._all ?? 0;

  const completedIdsByCourse = new Map<string, Set<string>>();
  const lastActivityByCourse = new Map<string, Date>();
  let secondsCompleted = 0;
  for (const row of progressRows) {
    secondsCompleted += row.lesson.durationSeconds;
    const completed = completedIdsByCourse.get(row.courseId) ?? new Set<string>();
    completed.add(row.lessonId);
    completedIdsByCourse.set(row.courseId, completed);
    const previous = lastActivityByCourse.get(row.courseId);
    if (!previous || row.completedAt > previous) lastActivityByCourse.set(row.courseId, row.completedAt);
  }

  const pickedCourseIds = pickContinueLearningCourses(
    activeEnrolments.map((enrolment) => ({
      courseId: enrolment.courseId,
      lastActivityAt: lastActivityByCourse.get(enrolment.courseId)?.toISOString() ?? null,
      enrolledAt: enrolment.createdAt.toISOString(),
    })),
    CONTINUE_LEARNING_LIMIT,
  );

  const continueLearning: ContinueLearningCardDto[] = [];
  if (pickedCourseIds.length > 0) {
    const [courses, lessons] = await Promise.all([
      // (4) Card headers for exactly the picked courses.
      db.course.findMany({
        where: { id: { in: pickedCourseIds } },
        select: {
          id: true,
          slug: true,
          title: true,
          thumbnailUrl: true,
          totalLessons: true,
          totalMinutes: true,
          category: { select: { name: true } },
        },
      }),
      // (5) Published curriculum of the card courses; a DRAFT lesson the owner
      // is editing must never surface as the learner's next step.
      db.lesson.findMany({
        where: { courseId: { in: pickedCourseIds }, status: LessonStatus.PUBLISHED },
        select: {
          id: true,
          title: true,
          type: true,
          durationSeconds: true,
          isPreview: true,
          courseId: true,
          position: true,
          section: { select: { position: true } },
        },
      }),
    ]);

    const courseById = new Map(courses.map((course) => [course.id, course]));
    const lessonsByCourse = new Map<string, typeof lessons>();
    for (const lesson of lessons) {
      const list = lessonsByCourse.get(lesson.courseId) ?? [];
      list.push(lesson);
      lessonsByCourse.set(lesson.courseId, list);
    }

    for (const courseId of pickedCourseIds) {
      const course = courseById.get(courseId);
      // Enrolments reference courses with onDelete: Restrict, so the course
      // row always exists; the guard keeps the mapping honest regardless.
      if (!course) continue;
      const completedIds = completedIdsByCourse.get(courseId) ?? new Set<string>();
      const orderedLessons = (lessonsByCourse.get(courseId) ?? []).sort((a, b) =>
        compareCurriculumOrder(
          { sectionPosition: a.section.position, position: a.position },
          { sectionPosition: b.section.position, position: b.position },
        ),
      );
      const nextLesson = pickNextLesson(orderedLessons, completedIds);

      continueLearning.push({
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        categoryName: course.category.name,
        thumbnailUrl: course.thumbnailUrl,
        totalLessons: course.totalLessons,
        totalMinutes: course.totalMinutes,
        completedLessons: completedIds.size,
        // The card uses the denormalized course total (catalog-consistent);
        // the per-course progress page counts published lessons instead.
        progressPercent: computeProgressPercent(completedIds.size, course.totalLessons),
        nextLesson: nextLesson ? toLessonSummary(nextLesson) : null,
        // No activity yet: the enrolment date keeps the card honest.
        lastActivityAt:
          (lastActivityByCourse.get(courseId) ?? enrolledAtOf(activeEnrolments, courseId)).toISOString(),
      });
    }
  }

  return {
    stats: {
      enrolledCourses: countFor(EnrolmentStatus.ACTIVE),
      completedCourses: countFor(EnrolmentStatus.COMPLETED),
      lessonsCompleted: progressRows.length,
      minutesCompleted: Math.floor(secondsCompleted / SECONDS_PER_MINUTE),
    },
    continueLearning,
  };
}

function toLessonSummary(lesson: {
  id: string;
  title: string;
  type: LessonSummaryDto["type"];
  durationSeconds: number;
  isPreview: boolean;
}): LessonSummaryDto {
  return {
    id: lesson.id,
    title: lesson.title,
    type: lesson.type,
    durationSeconds: lesson.durationSeconds,
    isPreview: lesson.isPreview,
  };
}

function enrolledAtOf(
  activeEnrolments: Array<{ courseId: string; createdAt: Date }>,
  courseId: string,
): Date {
  const enrolment = activeEnrolments.find((candidate) => candidate.courseId === courseId);
  // Every card course comes from an ACTIVE enrolment, so the row exists.
  if (!enrolment) throw new Error(`Dashboard card without enrolment: ${courseId}`);
  return enrolment.createdAt;
}
