import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const applicationDatabaseUrl = process.env.DATABASE_URL;

function databaseIdentity(value: string): string {
  const url = new URL(value);
  return `${url.username}@${url.hostname.replace("-pooler.", ".")}${url.pathname}`;
}

describe("course authoring integration", { skip: !testDatabaseUrl }, () => {
  let database: typeof import("@/server/db/client").db;

  before(async () => {
    if (
      applicationDatabaseUrl &&
      databaseIdentity(applicationDatabaseUrl) === databaseIdentity(testDatabaseUrl!)
    ) {
      throw new Error("TEST_DATABASE_URL must use an isolated database or Neon branch.");
    }
    Object.assign(process.env, { DATABASE_URL: testDatabaseUrl, DIRECT_URL: testDatabaseUrl });
    ({ db: database } = await import("@/server/db/client"));
  });

  after(async () => {
    await database?.$disconnect();
  });

  it("creates a course and its initial curriculum in one transaction", async () => {
    const suffix = randomUUID();
    const owner = await database.user.create({
      data: {
        name: "Course authoring test owner",
        email: `course-authoring-${suffix}@example.test`,
        emailNormalized: `course-authoring-${suffix}@example.test`,
        role: "OWNER",
      },
      select: { id: true },
    });
    const category = await database.category.create({
      data: {
        slug: `course-authoring-${suffix}`,
        name: "Course authoring test",
        icon: "test",
      },
      select: { id: true },
    });

    let courseId: string | undefined;
    try {
      const { createCourse } = await import("@/server/modules/courses/courses.service");
      const course = await createCourse(owner.id, {
        title: "Transactional course authoring",
        shortDescription: "An integration test course draft.",
        description:
          "This integration test verifies nested section and lesson creation in one database transaction.",
        categoryId: category.id,
        level: "BEGINNER",
        language: "English",
        priceMinor: 0,
        promoVideoUrl: "https://video.example.test/course-preview",
        curriculum: [
          {
            title: "Introduction",
            lessons: [
              {
                title: "Welcome lesson",
                type: "VIDEO",
                durationSeconds: 125,
                isPreview: true,
              },
            ],
          },
        ],
      });
      courseId = course.id;

      assert.equal(course.totalSections, 1);
      assert.equal(course.totalLessons, 1);
      assert.equal(course.totalMinutes, 3);
      assert.equal(course.sections[0].lessons[0].title, "Welcome lesson");
      assert.equal(course.promoVideoUrl, "https://video.example.test/course-preview");
    } finally {
      if (courseId) {
        await database.auditLog.deleteMany({ where: { entityId: courseId } });
        await database.course.deleteMany({ where: { id: courseId } });
      }
      await database.category.deleteMany({ where: { id: category.id } });
      await database.user.deleteMany({ where: { id: owner.id } });
    }
  });
});
