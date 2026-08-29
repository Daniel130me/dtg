import { z } from "zod";

// Wire contracts for the owner authoring API. Timestamps are ISO-8601 strings
// because these shapes describe the JSON boundary, not Prisma rows. Prices stay
// as integer minor units; the frontend formats them from priceMinor/currency.
//
// This module is imported by BOTH server routes and client components, so it
// must stay free of server-only imports (no @prisma/client runtime, no src/server).
// The enum tuples below mirror the Prisma enum values in prisma/schema.prisma.

export const COURSE_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;
export const COURSE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export const LESSON_TYPES = ["VIDEO", "TEXT", "QUIZ", "ASSIGNMENT"] as const;
export const LESSON_STATUSES = ["DRAFT", "PUBLISHED"] as const;

export const courseLevelSchema = z.enum(COURSE_LEVELS);
export const courseStatusSchema = z.enum(COURSE_STATUSES);
export const lessonTypeSchema = z.enum(LESSON_TYPES);
export const lessonStatusSchema = z.enum(LESSON_STATUSES);

export type CourseLevelValue = z.infer<typeof courseLevelSchema>;
export type CourseStatusValue = z.infer<typeof courseStatusSchema>;
export type LessonTypeValue = z.infer<typeof lessonTypeSchema>;

export const ownerCategoryRefSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
});

export const ownerLessonDtoSchema = z.object({
  id: z.uuid(),
  sectionId: z.uuid(),
  title: z.string(),
  type: lessonTypeSchema,
  status: lessonStatusSchema,
  position: z.number().int(),
  durationSeconds: z.number().int(),
  isPreview: z.boolean(),
  content: z.string().nullable(),
  videoUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ownerSectionDtoSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  position: z.number().int(),
  lessons: z.array(ownerLessonDtoSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// List shape: everything the owner course table renders, without the heavy
// description body or curriculum tree.
export const ownerCourseListItemDtoSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  shortDescription: z.string(),
  level: courseLevelSchema,
  language: z.string(),
  priceMinor: z.number().int(),
  currency: z.string(),
  status: courseStatusSchema,
  version: z.number().int(),
  totalSections: z.number().int(),
  totalLessons: z.number().int(),
  totalMinutes: z.number().int(),
  enrollmentCount: z.number().int(),
  ratingAverage: z.number().nullable(),
  ratingCount: z.number().int(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  category: ownerCategoryRefSchema.nullable(),
});

export const ownerCourseDetailDtoSchema = ownerCourseListItemDtoSchema.extend({
  description: z.string(),
  sections: z.array(ownerSectionDtoSchema),
  requirements: z.array(
    z.object({ id: z.uuid(), position: z.number().int(), text: z.string() }),
  ),
  outcomes: z.array(
    z.object({ id: z.uuid(), position: z.number().int(), text: z.string() }),
  ),
});

// Compact result of lifecycle transitions (publish/archive/unpublish).
export const ownerCourseLifecycleResultSchema = z.object({
  id: z.uuid(),
  status: courseStatusSchema,
  version: z.number().int(),
  publishedAt: z.string().nullable(),
});

export const ownerSectionMutationResultSchema = z.object({
  section: ownerSectionDtoSchema,
  courseVersion: z.number().int(),
});

export const ownerLessonMutationResultSchema = z.object({
  lesson: ownerLessonDtoSchema,
  courseVersion: z.number().int(),
});

export const ownerSectionReorderResultSchema = z.object({
  courseId: z.uuid(),
  courseVersion: z.number().int(),
  sections: z.array(z.object({ id: z.uuid(), position: z.number().int() })),
});

export const ownerChildDeletedResultSchema = z.object({
  courseId: z.uuid(),
  courseVersion: z.number().int(),
});

// ---------------------------------------------------------------------------
// Client-safe request schemas.
//
// These mirror the request bodies validated server-side in
// src/server/modules/courses/courses.schemas.ts. The server module cannot be
// imported from client components, so the rules are duplicated here on
// purpose; the named constants reproduce the Prisma column limits. Keep the
// two files in sync when the API rules change.
// ---------------------------------------------------------------------------

export const COURSE_TITLE_MIN_LENGTH = 4;
export const COURSE_TITLE_MAX_LENGTH = 200;
export const SHORT_DESCRIPTION_MIN_LENGTH = 10;
export const SHORT_DESCRIPTION_MAX_LENGTH = 320;
export const DESCRIPTION_MIN_LENGTH = 50;
export const DESCRIPTION_MAX_LENGTH = 6000;
export const LANGUAGE_MAX_LENGTH = 32;
// 10_000_000 minor units = 100,000.00; keeps prices inside the Int column range.
export const PRICE_MINOR_MAX = 10_000_000;
export const SLUG_MAX_LENGTH = 160;
export const SECTION_TITLE_MIN_LENGTH = 3;
export const SECTION_TITLE_MAX_LENGTH = 200;
export const LESSON_TITLE_MIN_LENGTH = 3;
export const LESSON_TITLE_MAX_LENGTH = 200;
export const LESSON_DURATION_MAX_SECONDS = 86_400;
export const LESSON_CONTENT_MAX_LENGTH = 20_000;
export const MIN_POSITION = 1;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createCourseSchema = z.object({
  title: z.string().trim().min(COURSE_TITLE_MIN_LENGTH).max(COURSE_TITLE_MAX_LENGTH),
  shortDescription: z
    .string()
    .trim()
    .min(SHORT_DESCRIPTION_MIN_LENGTH)
    .max(SHORT_DESCRIPTION_MAX_LENGTH),
  description: z.string().trim().min(DESCRIPTION_MIN_LENGTH).max(DESCRIPTION_MAX_LENGTH),
  categoryId: z.uuid(),
  level: courseLevelSchema,
  language: z.string().trim().min(1).max(LANGUAGE_MAX_LENGTH).default("English"),
  priceMinor: z.number().int().min(0).max(PRICE_MINOR_MAX).default(0),
  // Optional: generated from the title when absent. Immutable after creation.
  slug: z
    .string()
    .trim()
    .min(1)
    .max(SLUG_MAX_LENGTH)
    .regex(SLUG_PATTERN, "Slug may only contain lowercase letters, numbers, and dashes.")
    .optional(),
});

export const updateCourseSchema = z
  .object({
    title: z.string().trim().min(COURSE_TITLE_MIN_LENGTH).max(COURSE_TITLE_MAX_LENGTH).optional(),
    shortDescription: z
      .string()
      .trim()
      .min(SHORT_DESCRIPTION_MIN_LENGTH)
      .max(SHORT_DESCRIPTION_MAX_LENGTH)
      .optional(),
    description: z.string().trim().min(DESCRIPTION_MIN_LENGTH).max(DESCRIPTION_MAX_LENGTH).optional(),
    categoryId: z.uuid().optional(),
    level: courseLevelSchema.optional(),
    language: z.string().trim().min(1).max(LANGUAGE_MAX_LENGTH).optional(),
    priceMinor: z.number().int().min(0).max(PRICE_MINOR_MAX).optional(),
    // Optimistic concurrency: compared against the stored course version.
    expectedVersion: z.number().int().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

export const sectionCreateSchema = z.object({
  title: z.string().trim().min(SECTION_TITLE_MIN_LENGTH).max(SECTION_TITLE_MAX_LENGTH),
});

export const sectionUpdateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(SECTION_TITLE_MIN_LENGTH)
      .max(SECTION_TITLE_MAX_LENGTH)
      .optional(),
    // Optimistic concurrency against the parent course version.
    expectedVersion: z.number().int().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

export const lessonCreateSchema = z.object({
  title: z.string().trim().min(LESSON_TITLE_MIN_LENGTH).max(LESSON_TITLE_MAX_LENGTH),
  type: lessonTypeSchema,
  durationSeconds: z.number().int().min(0).max(LESSON_DURATION_MAX_SECONDS).default(0),
  isPreview: z.boolean().default(false),
  content: z.string().max(LESSON_CONTENT_MAX_LENGTH).optional(),
  videoUrl: z.url().max(2048).optional(),
});

export const lessonUpdateSchema = z
  .object({
    title: z.string().trim().min(LESSON_TITLE_MIN_LENGTH).max(LESSON_TITLE_MAX_LENGTH).optional(),
    type: lessonTypeSchema.optional(),
    durationSeconds: z.number().int().min(0).max(LESSON_DURATION_MAX_SECONDS).optional(),
    isPreview: z.boolean().optional(),
    // Nullable so the owner can clear stored content/media.
    content: z.string().max(LESSON_CONTENT_MAX_LENGTH).nullable().optional(),
    videoUrl: z.url().max(2048).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

export const moveLessonSchema = z.object({
  sectionId: z.uuid(),
  position: z.number().int().min(MIN_POSITION),
});

export const reorderSectionSchema = z.object({
  position: z.number().int().min(MIN_POSITION),
});

export type OwnerCategoryRefDto = z.infer<typeof ownerCategoryRefSchema>;
export type OwnerLessonDto = z.infer<typeof ownerLessonDtoSchema>;
export type OwnerSectionDto = z.infer<typeof ownerSectionDtoSchema>;
export type OwnerCourseListItemDto = z.infer<typeof ownerCourseListItemDtoSchema>;
export type OwnerCourseDetailDto = z.infer<typeof ownerCourseDetailDtoSchema>;
export type OwnerCourseLifecycleResult = z.infer<typeof ownerCourseLifecycleResultSchema>;
export type OwnerSectionMutationResult = z.infer<typeof ownerSectionMutationResultSchema>;
export type OwnerLessonMutationResult = z.infer<typeof ownerLessonMutationResultSchema>;
export type OwnerSectionReorderResult = z.infer<typeof ownerSectionReorderResultSchema>;
export type OwnerChildDeletedResult = z.infer<typeof ownerChildDeletedResultSchema>;

// Request body types (inputs, so defaulted fields stay optional for callers).
export type CreateCourseBody = z.input<typeof createCourseSchema>;
export type UpdateCourseBody = z.output<typeof updateCourseSchema>;
export type SectionCreateBody = z.input<typeof sectionCreateSchema>;
export type SectionUpdateBody = z.input<typeof sectionUpdateSchema>;
export type LessonCreateBody = z.input<typeof lessonCreateSchema>;
export type LessonUpdateBody = z.output<typeof lessonUpdateSchema>;
export type MoveLessonBody = z.infer<typeof moveLessonSchema>;
