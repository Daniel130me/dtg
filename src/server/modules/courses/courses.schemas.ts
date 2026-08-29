import { z } from "zod";
import { CourseStatus } from "@prisma/client";
import { validationError } from "@/server/http/errors";
import { paginationQuerySchema } from "@/server/http/pagination";
import {
  courseLevelSchema,
  courseStatusSchema,
  lessonTypeSchema,
} from "@/contracts/owner-courses";

// Field bounds mirror the column limits in prisma/schema.prisma.
export const COURSE_TITLE_MIN_LENGTH = 4;
export const COURSE_TITLE_MAX_LENGTH = 200;
export const SHORT_DESCRIPTION_MIN_LENGTH = 10;
export const SHORT_DESCRIPTION_MAX_LENGTH = 320;
export const DESCRIPTION_MIN_LENGTH = 50;
export const DESCRIPTION_MAX_LENGTH = 6000;
export const LANGUAGE_MAX_LENGTH = 32;
// 10_000_000 minor units = 100,000.00 USD; keeps prices inside Int range.
export const PRICE_MINOR_MAX = 10_000_000;
export const SLUG_MAX_LENGTH = 160;
export const SECTION_TITLE_MIN_LENGTH = 3;
export const SECTION_TITLE_MAX_LENGTH = 200;
export const LESSON_TITLE_MIN_LENGTH = 3;
export const LESSON_TITLE_MAX_LENGTH = 200;
// One day of content per lesson is already generous; caps Int storage.
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

// The slug is deliberately excluded: it forms the public course URL, so it is
// immutable after creation to keep external links and bookmarks stable.
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

export const listOwnerCoursesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CourseStatus).optional(),
  search: z.string().trim().max(COURSE_TITLE_MAX_LENGTH).optional(),
});

export const getOwnerCourseQuerySchema = z.object({
  expectedVersion: z.coerce.number().int().min(1).optional(),
});

// Route parameter validation keeps malformed identifiers out of the services.
export const courseIdParamSchema = z.uuid();
export const sectionIdParamSchema = z.uuid();
export const lessonIdParamSchema = z.uuid();

export function parsePathParam<TSchema extends z.ZodType>(
  schema: TSchema,
  value: string,
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type SectionCreateInput = z.infer<typeof sectionCreateSchema>;
export type SectionUpdateInput = z.infer<typeof sectionUpdateSchema>;
export type LessonCreateInput = z.infer<typeof lessonCreateSchema>;
export type LessonUpdateInput = z.infer<typeof lessonUpdateSchema>;
export type MoveLessonInput = z.infer<typeof moveLessonSchema>;
export type ListOwnerCoursesInput = z.infer<typeof listOwnerCoursesQuerySchema>;
export type GetOwnerCourseQueryInput = z.infer<typeof getOwnerCourseQuerySchema>;
