import { PrismaClient, CourseLevel, LessonType, CourseStatus } from "@prisma/client";
import {
  categories as mockCategories,
  courses as mockCourses,
  type Course as MockCourse,
} from "@/lib/prototype/mock-data";

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
  const published = await prisma.course.count({ where: { status: "PUBLISHED" } });
  console.info(`Seeded ${mockCategories.length} categories, ${mockCourses.length} courses (${published} published).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Database seeding failed.");
    await prisma.$disconnect();
    process.exitCode = 1;
  });
