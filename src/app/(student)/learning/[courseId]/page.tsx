import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { CourseStatus, EnrolmentStatus, LessonStatus } from "@prisma/client";
import { db } from "@/server/db/client";
import { requireAuthenticatedUserCached } from "@/server/auth/authorization";

// "Continue learning" hop for /learning/{courseSlug} (the dashboard rail links
// here): resolves the learner's next incomplete PUBLISHED lesson and forwards
// to the player. Two bounded queries: the course with the caller's enrolment
// and published curriculum, then the caller's completed lesson ids.
export default async function ContinueLearningPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId: slug } = await params;

  // requireAuthenticatedUser throws a 401 ApiError (not a redirect), so the
  // redirect below must stay OUTSIDE the try/catch (redirect() itself throws
  // too and a catch here would swallow it — house rule from the dashboard
  // guard).
  let authenticatedUserId: string;
  try {
    const { user } = await requireAuthenticatedUserCached(await headers());
    authenticatedUserId = user.id;
  } catch {
    redirect(`/login?returnTo=${encodeURIComponent(`/learning/${slug}`)}`);
  }

  const course = await db.course.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      enrolments: {
        where: { userId: authenticatedUserId },
        select: { status: true },
        take: 1,
      },
      sections: {
        orderBy: { position: "asc" },
        select: {
          lessons: {
            where: { status: LessonStatus.PUBLISHED },
            orderBy: { position: "asc" },
            select: { id: true },
          },
        },
      },
    },
  });

  // Unknown/unpublished course or no active learning journey: the enrol CTA
  // lives on the public course page.
  const enrolmentStatus = course?.enrolments[0]?.status;
  const hasActiveEnrolment =
    course !== null &&
    course.status === CourseStatus.PUBLISHED &&
    (enrolmentStatus === EnrolmentStatus.ACTIVE || enrolmentStatus === EnrolmentStatus.COMPLETED);
  if (!hasActiveEnrolment) {
    redirect(`/courses/${slug}`);
  }

  const publishedLessons = course.sections.flatMap((section) => section.lessons);
  if (publishedLessons.length === 0) {
    // Published course with no published lessons yet — nothing to play.
    redirect(`/courses/${slug}`);
  }

  const completedLessonIds = new Set(
    (
      await db.lessonProgress.findMany({
        where: { userId: authenticatedUserId, courseId: course.id },
        select: { lessonId: true },
      })
    ).map((row) => row.lessonId),
  );

  // First lesson without a completion row wins; a fully completed course hops
  // back to the first lesson for review.
  const nextLesson =
    publishedLessons.find((lesson) => !completedLessonIds.has(lesson.id)) ?? publishedLessons[0];

  redirect(`/learning/${slug}/${nextLesson.id}`);
}
