ALTER TABLE "Course" ALTER COLUMN "level" TYPE VARCHAR(80) USING "level"::text;

DROP TYPE "CourseLevel";

CREATE TABLE "CourseLevelOption" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourseLevelOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseLevelOption_slug_key" ON "CourseLevelOption"("slug");
CREATE INDEX "CourseLevelOption_sortOrder_name_idx" ON "CourseLevelOption"("sortOrder", "name");

INSERT INTO "CourseLevelOption" ("id", "slug", "name", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'beginner', 'BEGINNER', 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'intermediate', 'INTERMEDIATE', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'advanced', 'ADVANCED', 2, CURRENT_TIMESTAMP);