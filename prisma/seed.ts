import { PrismaClient, CourseLevel, CourseStatus, EnrolmentSource, LessonType } from "@prisma/client";
import {
  categories as mockCategories,
  courses as mockCourses,
} from "@/lib/prototype/mock-data";
import type { Course as MockCourse } from "@/lib/prototype/types";

const prisma = new PrismaClient();

/**
 * Deterministic development seed.
 *
 * Demo content is sourced from the prototype mock data so the UI prototype and
 * the database stay in sync until every screen is connected to real contracts.
 * All writes are upserts keyed by stable slugs; curriculum rows are rebuilt per
 * course so repeated seeds stay idempotent.
 */

/** "12:30" -> 750s, "10 min read" -> 600s, "2 hours" -> 7200s. */
function parseDurationSeconds(duration: string): number {
  const clockMatch = /^(\d+):(\d{2})$/.exec(duration);
  if (clockMatch) return Number(clockMatch[1]) * 60 + Number(clockMatch[2]);

  const hoursMatch = /^(\d+(?:\.\d+)?)\s*hours?$/i.exec(duration);
  if (hoursMatch) return Math.round(Number(hoursMatch[1]) * 3600);

  const minutesMatch = /^(\d+(?:\.\d+)?)\s*min/i.exec(duration);
  if (minutesMatch) return Math.round(Number(minutesMatch[1]) * 60);

  return 0;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Assessment seed data (Phase 9).
//
// Assessments are keyed by course slug + lesson title because the curriculum
// above is rebuilt (lessons deleted and recreated) on every seed run, so
// assessments must be attached AFTER the lesson rows exist. Re-seeding deletes
// the previous quiz/assignment rows first; their attempt/submission history
// cascades with them, which is acceptable for deterministic demo content.
// ---------------------------------------------------------------------------

interface QuizSeed {
  lessonTitle: string;
  passPercent: number;
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  questions: Array<{
    prompt: string;
    points: number;
    explanation: string | null;
    options: Array<{ text: string; isCorrect: boolean }>;
  }>;
}

interface AssignmentSeed {
  lessonTitle: string;
  instructions: string;
  maxPoints: number;
  dueAt: null;
  allowResubmission: boolean;
}

const ASSESSMENT_SEEDS: Record<
  string,
  { quiz?: QuizSeed; assignment?: AssignmentSeed }
> = {
  "complete-nextjs-react-masterclass": {
    quiz: {
      lessonTitle: "Section Quiz: Fundamentals",
      passPercent: 70,
      maxAttempts: 3,
      timeLimitMinutes: 15,
      questions: [
        {
          prompt: "Which directive marks a component as a React Server Component?",
          points: 1,
          explanation:
            "Server Components are the default in the App Router; 'use client' opts a component INTO client rendering, so a Server Component simply omits it.",
          options: [
            { text: "'use server'", isCorrect: false },
            { text: "'use client'", isCorrect: false },
            { text: "None — components are server components by default in the App Router", isCorrect: true },
            { text: "'use server component'", isCorrect: false },
          ],
        },
        {
          prompt: "What does the `c` in the `mcp` App Router convention folder stand for?",
          points: 1,
          explanation:
            "App Router file conventions include page.tsx, layout.tsx, loading.tsx, error.tsx, and not-found.tsx — there is no `mcp` convention.",
          options: [
            { text: "Middleware Control Point", isCorrect: false },
            { text: "This is a trick question — `mcp` is not an App Router convention", isCorrect: true },
            { text: "Module Cache Provider", isCorrect: false },
            { text: "Metadata Component Props", isCorrect: false },
          ],
        },
        {
          prompt: "Which hook is used to read URL search parameters inside a Client Component?",
          points: 1,
          explanation:
            "useSearchParams() reads the current URL's query string in client components; params arrive as route props instead.",
          options: [
            { text: "usePathname", isCorrect: false },
            { text: "useRouter().query", isCorrect: false },
            { text: "useSearchParams", isCorrect: true },
            { text: "useQuery", isCorrect: false },
          ],
        },
        {
          prompt: "When does a Next.js layout re-render its children on navigation?",
          points: 1,
          explanation:
            "Layouts persist across navigations and do not re-render; only their children (the route content) change.",
          options: [
            { text: "On every navigation within its segment", isCorrect: false },
            { text: "Only when the layout module file changes", isCorrect: true },
            { text: "Whenever a search parameter changes", isCorrect: false },
            { text: "Every time any page state updates", isCorrect: false },
          ],
        },
        {
          prompt: "Which caching layer does `revalidatePath` invalidate?",
          points: 1,
          explanation:
            "revalidatePath purges the cached payload for the given path so the next request re-renders it.",
          options: [
            { text: "The browser's HTTP cache", isCorrect: false },
            { text: "The service worker cache", isCorrect: false },
            { text: "The React state cache", isCorrect: false },
            { text: "The server-side route cache", isCorrect: true },
          ],
        },
      ],
    },
    assignment: {
      lessonTitle: "Assignment: Build a RSC Dashboard",
      instructions:
        "Build a small dashboard page that renders at least one React Server Component fetching data directly from the database, one Client Component with interactive filtering, and one loading.tsx skeleton. Submit a short write-up (200-400 words) describing your component boundaries and where you drew the server/client line, plus a link to your repository.",
      maxPoints: 100,
      dueAt: null,
      allowResubmission: true,
    },
  },
};

async function seedCourseAssessments(
  courseId: string,
  seeds: { quiz?: QuizSeed; assignment?: AssignmentSeed },
): Promise<void> {
  if (seeds.quiz) {
    const lesson = await prisma.lesson.findFirst({
      where: { courseId, title: seeds.quiz.lessonTitle },
      select: { id: true },
    });
    if (!lesson) throw new Error(`Quiz lesson "${seeds.quiz.lessonTitle}" missing for course ${courseId}`);
    // Attempts cascade with the quiz: dev seed content is rebuilt wholesale.
    await prisma.quiz.deleteMany({ where: { lessonId: lesson.id } });
    await prisma.quiz.create({
      data: {
        lessonId: lesson.id,
        courseId,
        passPercent: seeds.quiz.passPercent,
        maxAttempts: seeds.quiz.maxAttempts,
        timeLimitMinutes: seeds.quiz.timeLimitMinutes,
        questions: {
          create: seeds.quiz.questions.map((question, questionIndex) => ({
            position: questionIndex + 1,
            prompt: question.prompt,
            points: question.points,
            explanation: question.explanation,
            options: {
              create: question.options.map((option, optionIndex) => ({
                position: optionIndex + 1,
                text: option.text,
                isCorrect: option.isCorrect,
              })),
            },
          })),
        },
      },
      select: { id: true },
    });
  }

  if (seeds.assignment) {
    const lesson = await prisma.lesson.findFirst({
      where: { courseId, title: seeds.assignment.lessonTitle },
      select: { id: true },
    });
    if (!lesson) throw new Error(`Assignment lesson "${seeds.assignment.lessonTitle}" missing for course ${courseId}`);
    // Submissions/grades cascade with the assignment (dev seed content).
    await prisma.assignment.deleteMany({ where: { lessonId: lesson.id } });
    await prisma.assignment.create({
      data: {
        lessonId: lesson.id,
        courseId,
        instructions: seeds.assignment.instructions,
        maxPoints: seeds.assignment.maxPoints,
        dueAt: seeds.assignment.dueAt,
        allowResubmission: seeds.assignment.allowResubmission,
      },
      select: { id: true },
    });
  }
}

async function seedCategories(): Promise<void> {
  for (const [index, category] of mockCategories.entries()) {
    const slug = slugify(category.name);
    await prisma.category.upsert({
      where: { slug },
      create: { slug, name: category.name, icon: category.icon, sortOrder: index },
      update: { name: category.name, icon: category.icon, sortOrder: index },
      select: { id: true },
    });
  }
}

async function resolveCreatorUserId(): Promise<string> {
  const settings = await prisma.platformSettings.findUnique({
    where: { id: "platform" },
    select: { ownerUserId: true },
  });
  if (!settings) throw new Error("Platform owner must be provisioned before seeding courses.");
  return settings.ownerUserId;
}

async function seedCourse(course: MockCourse, creatorUserId: string): Promise<void> {
  const priceMinor = course.price === null ? 0 : Math.round(course.price * 100);
  const status: CourseStatus = course.isPublished ? "PUBLISHED" : "DRAFT";
  const publishedAt = course.isPublished ? new Date(course.lastUpdated) : null;
  const level = course.level.toUpperCase() as CourseLevel;

  const category = await prisma.category.findUnique({
    where: { slug: slugify(course.categoryName) },
    select: { id: true },
  });
  if (!category) throw new Error(`Category "${course.categoryName}" missing for course ${course.slug}`);

  const dbCourse = await prisma.course.upsert({
    where: { slug: course.slug },
    create: {
      slug: course.slug,
      title: course.title,
      shortDescription: course.shortDescription,
      description: course.description,
      categoryId: category.id,
      creatorUserId,
      level,
      priceMinor,
      status,
      publishedAt,
      enrollmentCount: course.studentsEnrolled,
      ratingAverage: course.rating,
      ratingCount: course.reviewCount,
    },
    update: {
      title: course.title,
      shortDescription: course.shortDescription,
      description: course.description,
      categoryId: category.id,
      level,
      priceMinor,
      status,
      publishedAt,
    },
    select: { id: true },
  });

  // Curriculum is author-owned demo data; rebuilding it keeps seeding simple
  // and deterministic without reimplementing reorder logic in the seed.
  await prisma.courseRequirement.deleteMany({ where: { courseId: dbCourse.id } });
  await prisma.courseOutcome.deleteMany({ where: { courseId: dbCourse.id } });
  await prisma.lesson.deleteMany({ where: { courseId: dbCourse.id } });
  await prisma.courseSection.deleteMany({ where: { courseId: dbCourse.id } });

  await prisma.courseRequirement.createMany({
    data: course.requirements.map((text, index) => ({
      courseId: dbCourse.id,
      position: index + 1,
      text,
    })),
  });
  await prisma.courseOutcome.createMany({
    data: course.whatYouLearn.map((text, index) => ({
      courseId: dbCourse.id,
      position: index + 1,
      text,
    })),
  });

  let totalLessons = 0;
  let totalSeconds = 0;
  for (const [sectionIndex, section] of course.sections.entries()) {
    const dbSection = await prisma.courseSection.create({
      data: {
        courseId: dbCourse.id,
        title: section.title,
        position: sectionIndex + 1,
      },
      select: { id: true },
    });
    for (const [lessonIndex, lesson] of section.lessons.entries()) {
      const durationSeconds = parseDurationSeconds(lesson.duration);
      totalLessons += 1;
      totalSeconds += durationSeconds;
      await prisma.lesson.create({
        data: {
          sectionId: dbSection.id,
          courseId: dbCourse.id,
          title: lesson.title,
          type: lesson.type.toUpperCase() as LessonType,
          status: "PUBLISHED",
          position: lessonIndex + 1,
          durationSeconds,
          isPreview: lesson.isPreview,
          content: lesson.content ?? null,
          videoUrl: lesson.videoUrl ?? null,
        },
        select: { id: true },
      });
    }
  }

  await prisma.course.update({
    where: { id: dbCourse.id },
    data: {
      totalSections: course.sections.length,
      totalLessons,
      totalMinutes: Math.round(totalSeconds / 60),
    },
    select: { id: true },
  });

  // Assessments attach to freshly rebuilt lesson rows, so they come last.
  const assessmentSeed = ASSESSMENT_SEEDS[course.slug];
  if (assessmentSeed) {
    await seedCourseAssessments(dbCourse.id, assessmentSeed);
  }
}

// ---------------------------------------------------------------------------
// Review seed data (Phase 10).
//
// Demo reviewers get ADMIN-source enrolments on the courses they review so
// the verified-enrolment invariant holds for every seeded row. Reviews are
// upserts keyed by (courseId, userId); the course rating aggregates are
// recomputed from VISIBLE rows at the end of the run so the denormalized
// Course.ratingAverage/ratingCount always match the seeded truth.
// ---------------------------------------------------------------------------

interface ReviewSeed {
  courseSlug: string;
  reviewerEmail: string;
  reviewerName: string;
  rating: number;
  body: string;
  /** Owner reply, if the platform owner has answered this review. */
  reply?: string;
  /** Moderation demo: hidden reviews are excluded from listing + aggregates. */
  status?: "VISIBLE" | "HIDDEN";
}

const DEMO_REVIEWERS = [
  { email: "reviewer-amara@example.test", name: "Amara Okafor" },
  { email: "reviewer-tunde@example.test", name: "Tunde Bakare" },
  { email: "reviewer-zainab@example.test", name: "Zainab Musa" },
];

const REVIEW_SEEDS: ReviewSeed[] = [
  {
    courseSlug: "complete-nextjs-react-masterclass",
    reviewerEmail: "reviewer-amara@example.test",
    reviewerName: "Amara Okafor",
    rating: 5,
    body:
      "The server/client boundary explanations finally made RSC click for me. The dashboard assignment mirrors real work — I shipped the same pattern at my job the following week.",
    reply:
      "Thank you, Amara! Watch for the caching deep-dive section — it builds directly on the dashboard exercise.",
  },
  {
    courseSlug: "complete-nextjs-react-masterclass",
    reviewerEmail: "reviewer-tunde@example.test",
    reviewerName: "Tunde Bakare",
    rating: 4,
    body:
      "Excellent pacing and the quiz checkpoints kept me honest. Would love a follow-up on testing server components, but as a foundation this is the best I have taken.",
  },
  {
    courseSlug: "complete-nextjs-react-masterclass",
    reviewerEmail: "reviewer-zainab@example.test",
    reviewerName: "Zainab Musa",
    rating: 2,
    body: "Download links were broken for two lessons when I took it.",
    status: "HIDDEN",
  },
  {
    courseSlug: "intro-ui-ux-design",
    reviewerEmail: "reviewer-zainab@example.test",
    reviewerName: "Zainab Musa",
    rating: 5,
    body:
      "Went from blank canvas to a confident design system in two weekends. The component-variant exercises are worth the price alone.",
    reply: "So glad the variants module landed well — that one took the longest to design!",
  },
  {
    courseSlug: "intro-ui-ux-design",
    reviewerEmail: "reviewer-amara@example.test",
    reviewerName: "Amara Okafor",
    rating: 4,
    body: "Great practical exercises. The auto-layout section assumes a little prior Figma familiarity.",
  },
];

async function seedReviews(): Promise<void> {
  const ownerUserId = await resolveCreatorUserId();

  for (const reviewer of DEMO_REVIEWERS) {
    const emailNormalized = reviewer.email.toLowerCase();
    await prisma.user.upsert({
      where: { emailNormalized },
      update: {},
      create: {
        name: reviewer.name,
        email: reviewer.email,
        emailNormalized,
        profile: {
          create: { displayName: reviewer.name, countryCode: "NG", timezone: "Africa/Lagos" },
        },
      },
      select: { id: true },
    });
  }

  for (const seed of REVIEW_SEEDS) {
    const course = await prisma.course.findUnique({
      where: { slug: seed.courseSlug },
      select: { id: true },
    });
    if (!course) throw new Error(`Review seed: course "${seed.courseSlug}" missing.`);

    const reviewer = await prisma.user.findUnique({
      where: { emailNormalized: seed.reviewerEmail },
      select: { id: true },
    });
    if (!reviewer) throw new Error(`Review seed: reviewer "${seed.reviewerEmail}" missing.`);

    // The verified-enrolment invariant: every seeded review sits on an enrolment.
    await prisma.enrolment.upsert({
      where: { userId_courseId: { userId: reviewer.id, courseId: course.id } },
      update: {},
      create: {
        userId: reviewer.id,
        courseId: course.id,
        source: EnrolmentSource.ADMIN,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    await prisma.review.upsert({
      where: { courseId_userId: { courseId: course.id, userId: reviewer.id } },
      update: {
        rating: seed.rating,
        body: seed.body,
        status: seed.status ?? "VISIBLE",
        reply: seed.reply ?? null,
        repliedAt: seed.reply ? new Date() : null,
        repliedByUserId: seed.reply ? ownerUserId : null,
      },
      create: {
        courseId: course.id,
        userId: reviewer.id,
        rating: seed.rating,
        body: seed.body,
        status: seed.status ?? "VISIBLE",
        reply: seed.reply ?? null,
        repliedAt: seed.reply ? new Date() : null,
        repliedByUserId: seed.reply ? ownerUserId : null,
      },
      select: { id: true },
    });
  }

  // Recompute the denormalized rating aggregates from the seeded truth so the
  // public catalog never shows a rating the review rows do not support.
  const coursesWithReviews = await prisma.course.findMany({
    where: { reviews: { some: {} } },
    select: { id: true },
  });
  for (const course of coursesWithReviews) {
    const aggregate = await prisma.review.aggregate({
      where: { courseId: course.id, status: "VISIBLE" },
      _avg: { rating: true },
      _count: { _all: true },
    });
    await prisma.course.update({
      where: { id: course.id },
      data: {
        ratingAverage: aggregate._avg.rating === null ? null : Number(aggregate._avg.rating.toFixed(2)),
        ratingCount: aggregate._count._all,
      },
      select: { id: true },
    });
  }
}

// ---------------------------------------------------------------------------
// Owner analytics demo data (Phase 11).
//
// Ten deterministic learners spread across the last six months, with
// enrolments, purchase orders + SUCCEEDED payments, lesson progress and a few
// completed courses. This gives the owner dashboard (docs/ANALYTICS_METRICS.md)
// a truthful-looking trend without touching any service logic. Every write is
// an upsert on a natural key so repeated seeds converge; payment success times
// are backfilled with raw SQL because @updatedAt cannot be set through the
// client, and the trend buckets on Payment.updatedAt for SUCCEEDED rows.
// ---------------------------------------------------------------------------

const ANALYTICS_LEARNERS = [
  "Chiamaka Eze",
  "Emeka Obi",
  "Fatima Abubakar",
  "Kelechi Nwosu",
  "Aisha Bello",
  "Olumide Adeyemi",
  "Ngozi Okafor",
  "Yusuf Ibrahim",
  "Blessing Adebayo",
  "Tope Alabi",
];

/** First day, N months before the current UTC month, at a fixed time of day. */
function analyticsDate(monthsAgo: number, day: number, hour: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day, hour, 24, 0));
}

/** Progress/derivative dates keep inside the past (never the future). */
function analyticsDateCapped(date: Date): Date {
  return date.getTime() > Date.now() ? new Date(Date.now() - 60_000) : date;
}

async function seedAnalyticsDemo(): Promise<void> {
  const courses = await prisma.course.findMany({
    where: { status: CourseStatus.PUBLISHED },
    select: { id: true, slug: true, title: true, priceMinor: true, currency: true },
    orderBy: { createdAt: "asc" },
  });
  if (courses.length === 0) throw new Error("Analytics seed: no published courses.");

  const lessonRows = await prisma.lesson.findMany({
    where: { courseId: { in: courses.map((course) => course.id) }, status: "PUBLISHED" },
    select: { id: true, courseId: true, section: { select: { position: true } }, position: true },
  });
  const lessonsByCourse = new Map<string, Array<{ id: string }>>();
  for (const lesson of lessonRows) {
    const list = lessonsByCourse.get(lesson.courseId) ?? [];
    list.push(lesson);
    lessonsByCourse.set(lesson.courseId, list);
  }
  for (const list of lessonsByCourse.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  // (1) Learners: one per name, joined (i % 6) months ago.
  const learnerIds: string[] = [];
  for (const [index, name] of ANALYTICS_LEARNERS.entries()) {
    const email = `analytics-learner-${index + 1}@example.test`;
    const createdAt = analyticsDate(index % 6, 3 + (index % 20), 9 + (index % 10));
    const learner = await prisma.user.upsert({
      where: { emailNormalized: email },
      update: { createdAt },
      create: {
        name,
        email,
        emailNormalized: email,
        emailVerified: true,
        createdAt,
        profile: { create: { displayName: name, countryCode: "NG", timezone: "Africa/Lagos" } },
      },
      select: { id: true },
    });
    learnerIds.push(learner.id);
  }

  const paymentSuccessDates: Array<{ id: string; succeededAt: Date }> = [];

  // (2) Enrolments: learner i takes courses (i*2) % C and ((i*2)+1) % C.
  for (const [learnerIndex, userId] of learnerIds.entries()) {
    const coursePairs = new Set<number>();
    coursePairs.add((learnerIndex * 2) % courses.length);
    coursePairs.add((learnerIndex * 2 + 1) % courses.length);
    if (learnerIndex % 4 === 0) coursePairs.add((learnerIndex * 5 + 2) % courses.length);

    for (const courseIndex of coursePairs) {
      const course = courses[courseIndex];
      const enrolledAt = analyticsDate(
        (learnerIndex + courseIndex) % 6,
        3 + ((learnerIndex + courseIndex) % 22),
        8 + (courseIndex % 12),
      );

      // Purchase plumbing first so the enrolment can reference the order item.
      // Order and payment are written separately (no wrapping transaction), so
      // every combination of partial state from an earlier failed run must
      // converge — hence query-then-create on both natural keys.
      let orderItemId: string | null = null;
      if (course.priceMinor > 0) {
        const orderRef = `seed-analytics-order-${learnerIndex + 1}-${courseIndex + 1}`;
        const paymentRef = `seed-analytics-payment-${learnerIndex + 1}-${courseIndex + 1}`;
        const succeededAt = analyticsDateCapped(new Date(enrolledAt.getTime() + 2 * 60_000));

        let order = await prisma.order.findUnique({
          where: { provider_providerRef: { provider: "flutterwave", providerRef: orderRef } },
          select: { id: true, items: { select: { id: true, courseId: true } } },
        });
        if (!order) {
          order = await prisma.order.create({
            data: {
              userId,
              status: "PAID",
              currency: course.currency,
              totalMinor: course.priceMinor,
              provider: "flutterwave",
              providerRef: orderRef,
              createdAt: enrolledAt,
              items: {
                create: {
                  courseId: course.id,
                  unitPriceMinor: course.priceMinor,
                  currency: course.currency,
                },
              },
            },
            select: { id: true, items: { select: { id: true, courseId: true } } },
          });
        }
        orderItemId = order.items.find((item) => item.courseId === course.id)?.id ?? null;
        if (!orderItemId) {
          const item = await prisma.orderItem.create({
            data: {
              orderId: order.id,
              courseId: course.id,
              unitPriceMinor: course.priceMinor,
              currency: course.currency,
            },
            select: { id: true },
          });
          orderItemId = item.id;
        }

        let payment = await prisma.payment.findUnique({
          where: { provider_providerRef: { provider: "flutterwave", providerRef: paymentRef } },
          select: { id: true },
        });
        if (!payment) {
          payment = await prisma.payment.create({
            data: {
              orderId: order.id,
              provider: "flutterwave",
              providerRef: paymentRef,
              status: "SUCCEEDED",
              amountMinor: course.priceMinor,
              currency: course.currency,
              createdAt: enrolledAt,
            },
            select: { id: true },
          });
        }
        paymentSuccessDates.push({ id: payment.id, succeededAt });
      }

      const enrolment = await prisma.enrolment.upsert({
        where: { userId_courseId: { userId, courseId: course.id } },
        update: { orderItemId },
        create: {
          userId,
          courseId: course.id,
          status: "ACTIVE",
          source: course.priceMinor > 0 ? EnrolmentSource.PURCHASE : EnrolmentSource.FREE,
          orderItemId,
          createdAt: enrolledAt,
        },
        select: { id: true },
      });

      // Progress: deterministic slice of the published curriculum; finishing
      // everything flips the enrolment to COMPLETED.
      const lessons = lessonsByCourse.get(course.id) ?? [];
      const completeCount =
        lessons.length === 0 ? 0 : ((learnerIndex * 7 + courseIndex * 3) % (lessons.length + 1));
      let lastCompletedAt: Date | null = null;
      for (const [lessonOffset, lesson] of lessons.slice(0, completeCount).entries()) {
        const completedAt = analyticsDateCapped(
          new Date(enrolledAt.getTime() + (lessonOffset + 1) * 3 * 24 * 60 * 60_000),
        );
        await prisma.lessonProgress.upsert({
          where: { userId_lessonId: { userId, lessonId: lesson.id } },
          update: { completedAt },
          create: { userId, lessonId: lesson.id, courseId: course.id, completedAt },
          select: { id: true },
        });
        lastCompletedAt = completedAt;
      }

      const finished = lessons.length > 0 && completeCount === lessons.length;
      await prisma.enrolment.update({
        where: { id: enrolment.id },
        data: {
          status: finished ? "COMPLETED" : "ACTIVE",
          completedAt: finished ? lastCompletedAt : null,
        },
        select: { id: true },
      });
    }
  }

  // (3) Payment success times: @updatedAt cannot be provided through the
  // client, and the revenue trend buckets on it, so backfill with raw SQL.
  for (const { id, succeededAt } of paymentSuccessDates) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Payment" SET "updatedAt" = $1 WHERE "id" = $2::uuid`,
      succeededAt,
      id,
    );
  }

  // (4) Recompute the denormalized enrolment counters from the seeded truth.
  for (const course of courses) {
    const count = await prisma.enrolment.count({
      where: { courseId: course.id, status: { not: "REVOKED" } },
    });
    await prisma.course.update({
      where: { id: course.id },
      data: { enrollmentCount: count },
      select: { id: true },
    });
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development seed data cannot be loaded in production.");
  }

  await prisma.user.upsert({
    where: { emailNormalized: "student@example.test" },
    update: {},
    create: {
      name: "Demo Student",
      email: "student@example.test",
      emailNormalized: "student@example.test",
      profile: { create: { displayName: "Demo Student", countryCode: "NG", timezone: "Africa/Lagos" } },
    },
    select: { id: true },
  });

  await seedCategories();
  const creatorUserId = await resolveCreatorUserId();
  for (const course of mockCourses) {
    await seedCourse(course, creatorUserId);
  }
  await seedReviews();
  await seedAnalyticsDemo();
  const published = await prisma.course.count({ where: { status: "PUBLISHED" } });
  console.info(
    `Seeded ${mockCategories.length} categories, ${mockCourses.length} courses (${published} published), ${REVIEW_SEEDS.length} reviews, ${ANALYTICS_LEARNERS.length} analytics learners.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Database seeding failed.");
    await prisma.$disconnect();
    process.exitCode = 1;
  });
