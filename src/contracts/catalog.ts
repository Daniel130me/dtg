import { z } from "zod";

// ---------------------------------------------------------------------------
// Named constants (no magic values)
// ---------------------------------------------------------------------------

export const COURSE_SEARCH_MAX_LENGTH = 100;
export const CATEGORY_SLUG_MAX_LENGTH = 120;
export const COURSE_SLUG_MAX_LENGTH = 160;

export const COURSE_PAGE_LIMIT_MIN = 1;
export const COURSE_PAGE_LIMIT_MAX = 24;
export const COURSE_PAGE_LIMIT_DEFAULT = 12;

/** A course is free when its price is zero minor units. */
export const FREE_PRICE_MINOR = 0;

/** Courses published within this window of "now" carry the "new" badge. */
export const NEW_BADGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Courses with at least this many enrolments carry the "popular" badge. */
export const POPULAR_ENROLLMENT_THRESHOLD = 2500;

export const COURSE_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;
export const COURSE_PRICE_FILTERS = ["ALL", "FREE", "PAID"] as const;
export const COURSE_SORTS = ["NEWEST", "POPULAR", "RATING", "PRICE_ASC", "PRICE_DESC"] as const;
export const LESSON_TYPES = ["VIDEO", "TEXT", "QUIZ", "ASSIGNMENT"] as const;

export type CourseLevel = (typeof COURSE_LEVELS)[number];
export type CoursePriceFilter = (typeof COURSE_PRICE_FILTERS)[number];
export type CourseSortKey = (typeof COURSE_SORTS)[number];
export type LessonType = (typeof LESSON_TYPES)[number];

// ---------------------------------------------------------------------------
// Badge derivation
// ---------------------------------------------------------------------------

export const COURSE_BADGES = ["new", "popular", "free"] as const;
export type CourseBadgeValue = (typeof COURSE_BADGES)[number];
export type CourseBadge = CourseBadgeValue | null;

/**
 * Badge precedence: free > new > popular.
 * - "free"    when priceMinor === FREE_PRICE_MINOR;
 * - "new"     when published strictly less than NEW_BADGE_WINDOW_MS ago;
 * - "popular" when enrollmentCount >= POPULAR_ENROLLMENT_THRESHOLD;
 * - null when no rule matches.
 * `now` is injectable so the derivation stays deterministic and testable.
 */
export interface BadgeableCourse {
  priceMinor: number;
  publishedAt: string | Date | null;
  enrollmentCount: number;
}

export function deriveBadge(course: BadgeableCourse, now: Date = new Date()): CourseBadge {
  if (course.priceMinor === FREE_PRICE_MINOR) return "free";
  if (course.publishedAt !== null) {
    const ageMs = now.getTime() - new Date(course.publishedAt).getTime();
    if (ageMs < NEW_BADGE_WINDOW_MS) return "new";
  }
  if (course.enrollmentCount >= POPULAR_ENROLLMENT_THRESHOLD) return "popular";
  return null;
}

// ---------------------------------------------------------------------------
// Catalog list query
// ---------------------------------------------------------------------------

export const courseListQuerySchema = z.object({
  search: z.string().max(COURSE_SEARCH_MAX_LENGTH).optional(),
  category: z.string().min(1).max(CATEGORY_SLUG_MAX_LENGTH).optional(),
  level: z.enum(COURSE_LEVELS).optional(),
  price: z.enum(COURSE_PRICE_FILTERS).default("ALL"),
  sort: z.enum(COURSE_SORTS).default("NEWEST"),
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(COURSE_PAGE_LIMIT_MIN)
    .max(COURSE_PAGE_LIMIT_MAX)
    .default(COURSE_PAGE_LIMIT_DEFAULT),
});

export type CourseListQuery = z.infer<typeof courseListQuerySchema>;

/** Path parameter for the course detail endpoint. */
export const courseSlugParamSchema = z.object({
  slug: z.string().min(1).max(COURSE_SLUG_MAX_LENGTH),
});

// ---------------------------------------------------------------------------
// Public DTOs
// ---------------------------------------------------------------------------

export const courseListItemDtoSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  shortDescription: z.string(),
  level: z.enum(COURSE_LEVELS),
  language: z.string(),
  priceMinor: z.number().int(),
  currency: z.string(),
  isFree: z.boolean(),
  categoryName: z.string(),
  categorySlug: z.string(),
  thumbnailUrl: z.string().nullable(),
  totalSections: z.number().int(),
  totalLessons: z.number().int(),
  totalMinutes: z.number().int(),
  enrollmentCount: z.number().int(),
  ratingAverage: z.number().nullable(),
  ratingCount: z.number().int(),
  publishedAt: z.string(),
  badge: z.enum(COURSE_BADGES).nullable(),
});

export type CourseListItemDto = z.infer<typeof courseListItemDtoSchema>;

export const courseLessonDtoSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  type: z.enum(LESSON_TYPES),
  position: z.number().int(),
  durationSeconds: z.number().int(),
  isPreview: z.boolean(),
  hasContent: z.boolean(),
  videoUrl: z.string().nullable(),
});

export type CourseLessonDto = z.infer<typeof courseLessonDtoSchema>;

export const courseSectionDtoSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  position: z.number().int(),
  lessons: z.array(courseLessonDtoSchema),
});

export type CourseSectionDto = z.infer<typeof courseSectionDtoSchema>;

export const courseInstructorDtoSchema = z.object({
  name: z.string(),
  title: z.string(),
  bio: z.string().nullable(),
});

export type CourseInstructorDto = z.infer<typeof courseInstructorDtoSchema>;

export const courseDetailDtoSchema = courseListItemDtoSchema.extend({
  description: z.string(),
  promoVideoUrl: z.string().nullable(),
  requirements: z.array(z.string()),
  outcomes: z.array(z.string()),
  sections: z.array(courseSectionDtoSchema),
  instructor: courseInstructorDtoSchema,
});

export type CourseDetailDto = z.infer<typeof courseDetailDtoSchema>;

export const paginatedCoursesDtoSchema = z.object({
  items: z.array(courseListItemDtoSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});

export type PaginatedCoursesDto = z.infer<typeof paginatedCoursesDtoSchema>;

export const categoryDtoSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  icon: z.string(),
  courseCount: z.number().int(),
});

export type CategoryDto = z.infer<typeof categoryDtoSchema>;
