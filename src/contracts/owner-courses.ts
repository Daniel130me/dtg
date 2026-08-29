import { z } from "zod";
import { CourseLevel, CourseStatus, LessonStatus, LessonType } from "@prisma/client";

// Wire contracts for the owner authoring API. Timestamps are ISO-8601 strings
// because these shapes describe the JSON boundary, not Prisma rows. Prices stay
// as integer minor units; the frontend formats them from priceMinor/currency.

export const courseLevelSchema = z.enum(CourseLevel);
export const courseStatusSchema = z.enum(CourseStatus);
export const lessonTypeSchema = z.enum(LessonType);
export const lessonStatusSchema = z.enum(LessonStatus);

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
