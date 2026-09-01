import { LessonStatus } from "@prisma/client";
import type { LessonAccessDto } from "@/contracts/learning";
import { LESSON_NOT_FOUND } from "@/contracts/learning";
import { LESSON_VIDEO_PLAYBACK_URL_TTL_SECONDS } from "@/contracts/lesson-video";
import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import { compareCurriculumOrder, describeLessonAccess } from "@/server/modules/learning/learning.logic";
import { createSignedGetUrl } from "@/server/storage/r2";

// Authorization model: lesson reads are public — the access level is computed
// per caller (signed-out callers resolve to userId = null) and content bytes
// are stripped for NONE access, so the paywall holds without a 404.

/**
 * Lesson player read model. Signed-out callers (userId = null) can read
 * PREVIEW lessons; everyone else is resolved by the shared access matrix.
 *
 * Query budget: 1 (lesson+section+course) + 1 (published siblings) +
 * 2 when signed in (enrolment, completion marker).
 */
export async function getLessonAccess(
  userId: string | null,
  lessonId: string,
): Promise<LessonAccessDto> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      position: true,
      durationSeconds: true,
      isPreview: true,
      content: true,
      videoUrl: true,
      videoKey: true,
      // The Lesson model denormalizes courseId without a course relation, so
      // the course summary rides on the section's course relation.
      section: {
        select: {
          title: true,
          position: true,
          course: { select: { id: true, slug: true, title: true } },
        },
      },
    },
  });
  if (!lesson) throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");

  let enrolmentStatus: string | null = null;
  let completed = false;
  if (userId) {
    const [enrolment, progress] = await Promise.all([
      db.enrolment.findUnique({
        where: { userId_courseId: { userId, courseId: lesson.section.course.id } },
        select: { status: true },
      }),
      db.lessonProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId } },
        select: { id: true },
      }),
    ]);
    enrolmentStatus = enrolment?.status ?? null;
    completed = progress !== null;
  }

  const access = describeLessonAccess({
    enrolmentStatus,
    isPreview: lesson.isPreview,
    lessonStatus: lesson.status,
  });
  if (access === "NOT_FOUND") {
    // Draft lessons read as not-found for learners; owner previews happen in
    // the owner console, never through the learner API.
    throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");
  }

  // One flat read for prev/next neighbours; ordered exactly like the
  // progress page (section position, then lesson position).
  const siblings = await db.lesson.findMany({
    where: { courseId: lesson.section.course.id, status: LessonStatus.PUBLISHED },
    select: { id: true, title: true, position: true, section: { select: { position: true } } },
  });
  siblings.sort((a, b) =>
    compareCurriculumOrder(
      { sectionPosition: a.section.position, position: a.position },
      { sectionPosition: b.section.position, position: b.position },
    ),
  );

  const currentIndex = siblings.findIndex((sibling) => sibling.id === lesson.id);
  const neighbour = (offset: -1 | 1): { id: string; title: string } | null => {
    const index = currentIndex + offset;
    const sibling = currentIndex >= 0 && index >= 0 && index < siblings.length
      ? siblings[index]
      : null;
    return sibling ? { id: sibling.id, title: sibling.title } : null;
  };

  // The paywall contract: NONE callers receive the lesson shell without
  // content bytes so the client can render the enrol CTA.
  const unlocked = access !== "NONE";
  const playableVideoUrl =
    unlocked && lesson.videoKey
      ? await createSignedGetUrl({
          objectKey: lesson.videoKey,
          expiresInSeconds: LESSON_VIDEO_PLAYBACK_URL_TTL_SECONDS,
        })
      : lesson.videoUrl;
  return {
    access,
    // The completion marker is only meaningful for enrolled learners.
    completed: access === "ENROLLED" ? completed : false,
    lesson: {
      id: lesson.id,
      title: lesson.title,
      type: lesson.type,
      durationSeconds: lesson.durationSeconds,
      isPreview: lesson.isPreview,
      content: unlocked ? lesson.content : null,
      videoUrl: unlocked ? playableVideoUrl : null,
    },
    sectionTitle: lesson.section.title,
    prevLesson: neighbour(-1),
    nextLesson: neighbour(1),
    course: lesson.section.course,
  };
}
