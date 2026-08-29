import { z } from "zod";
import { LESSON_TYPES } from "@/contracts/catalog";

// ---------------------------------------------------------------------------
// Named constants (no magic values)
// ---------------------------------------------------------------------------

/** Size limits enforced by the server and mirrored here for client hints. */
export const NOTE_BODY_MAX = 5000;
export const THREAD_TITLE_MAX = 200;
export const POST_BODY_MAX = 5000;

/** Bounded reads: page sizes for discussion threads and replies. */
export const THREAD_PAGE_LIMIT_DEFAULT = 10;
export const THREAD_PAGE_LIMIT_MAX = 20;
export const REPLY_PAGE_LIMIT_DEFAULT = 20;
export const REPLY_PAGE_LIMIT_MAX = 50;

/** The dashboard "continue learning" rail size. */
export const CONTINUE_LEARNING_LIMIT = 3;

/**
 * Lesson visibility for the caller: enrolled learners get everything,
 * preview-marked lessons are public, everything else is hidden.
 */
export const LESSON_ACCESS_LEVELS = ["ENROLLED", "PREVIEW", "NONE"] as const;
export type LessonAccessLevel = (typeof LESSON_ACCESS_LEVELS)[number];

/** Client-safe tuple mirroring the Prisma DiscussionStatus enum. */
export const DISCUSSION_STATUSES = ["ACTIVE", "HIDDEN"] as const;
export type DiscussionStatusValue = (typeof DISCUSSION_STATUSES)[number];

/** Client-matchable error codes shared by server and client. */
export const LESSON_NOT_FOUND = "LESSON_NOT_FOUND";
export const LESSON_NOT_ACCESSIBLE = "LESSON_NOT_ACCESSIBLE";
export const LESSON_COMPLETION_MONOTONIC = "LESSON_COMPLETION_MONOTONIC";
export const COURSE_NOT_ENROLLED = "COURSE_NOT_ENROLLED";

// ---------------------------------------------------------------------------
// Query contracts
// ---------------------------------------------------------------------------

export const threadListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(THREAD_PAGE_LIMIT_MAX)
    .default(THREAD_PAGE_LIMIT_DEFAULT),
});

export const replyListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(REPLY_PAGE_LIMIT_MAX)
    .default(REPLY_PAGE_LIMIT_DEFAULT),
});

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

const lessonSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  type: z.enum(LESSON_TYPES),
  durationSeconds: z.number().int().nonnegative(),
  isPreview: z.boolean(),
});

/** One "continue learning" card on the learner dashboard. */
export const continueLearningCardSchema = z.object({
  courseId: z.uuid(),
  courseSlug: z.string(),
  courseTitle: z.string(),
  categoryName: z.string(),
  thumbnailUrl: z.string().nullable(),
  totalLessons: z.number().int().nonnegative(),
  totalMinutes: z.number().int().nonnegative(),
  completedLessons: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
  nextLesson: lessonSummarySchema.nullable(),
  lastActivityAt: z.iso.datetime(),
});

export const learnerDashboardSchema = z.object({
  stats: z.object({
    enrolledCourses: z.number().int().nonnegative(),
    completedCourses: z.number().int().nonnegative(),
    lessonsCompleted: z.number().int().nonnegative(),
    minutesCompleted: z.number().int().nonnegative(),
  }),
  continueLearning: z.array(continueLearningCardSchema),
});

/** The learner's full curriculum with per-lesson completion state. */
export const courseProgressSchema = z.object({
  course: z.object({ id: z.uuid(), slug: z.string(), title: z.string() }),
  totalLessons: z.number().int().nonnegative(),
  completedLessons: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
  nextLesson: lessonSummarySchema.nullable(),
  sections: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      position: z.number().int(),
      lessons: z.array(lessonSummarySchema.extend({ completed: z.boolean() })),
    }),
  ),
});

/**
 * Lesson detail for the player. `content`/`videoUrl` are null unless the
 * caller has access (enrolled, or the lesson is an explicit public preview).
 */
export const lessonAccessSchema = z.object({
  access: z.enum(LESSON_ACCESS_LEVELS),
  completed: z.boolean(),
  lesson: lessonSummarySchema.extend({
    content: z.string().nullable(),
    videoUrl: z.string().nullable(),
  }),
  sectionTitle: z.string(),
  /** Neighbours within the course curriculum for prev/next navigation. */
  prevLesson: lessonSummarySchema.pick({ id: true, title: true }).nullable(),
  nextLesson: lessonSummarySchema.pick({ id: true, title: true }).nullable(),
  course: z.object({ id: z.uuid(), slug: z.string(), title: z.string() }),
});

/**
 * Body of POST /learning/lessons/{lessonId}/progress. Completion is monotonic:
 * only `true` is accepted, repeats are idempotent.
 */
export const progressUpdateSchema = z.object({ completed: z.literal(true) });

export const progressResultSchema = z.object({
  lessonId: z.uuid(),
  completed: z.literal(true),
  totalLessons: z.number().int().nonnegative(),
  completedLessons: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
  courseCompleted: z.boolean(),
});

export const lessonNoteSchema = z.object({
  lessonId: z.uuid(),
  body: z.string().max(NOTE_BODY_MAX),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const noteUpsertSchema = z.object({
  body: z.string().trim().min(1).max(NOTE_BODY_MAX),
});

const discussionAuthorSchema = z.object({ id: z.uuid(), name: z.string() });

export const discussionThreadSummarySchema = z.object({
  id: z.uuid(),
  lessonId: z.uuid(),
  lessonTitle: z.string(),
  title: z.string(),
  status: z.enum(DISCUSSION_STATUSES),
  postCount: z.number().int().nonnegative(),
  lastActivityAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  author: discussionAuthorSchema,
});

export const paginatedThreadsSchema = z.object({
  items: z.array(discussionThreadSummarySchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

export const discussionPostSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  status: z.enum(DISCUSSION_STATUSES),
  createdAt: z.iso.datetime(),
  author: discussionAuthorSchema,
});

export const threadDetailSchema = z.object({
  thread: discussionThreadSummarySchema,
  posts: z.array(discussionPostSchema),
  nextCursor: z.string().nullable(),
  totalPosts: z.number().int().nonnegative(),
});

export const threadCreateSchema = z.object({
  title: z.string().trim().min(1).max(THREAD_TITLE_MAX),
  body: z.string().trim().min(1).max(POST_BODY_MAX),
});

export const replyCreateSchema = z.object({
  body: z.string().trim().min(1).max(POST_BODY_MAX),
});

/** Body of the owner moderation endpoints. */
export const moderationUpdateSchema = z.object({ status: z.enum(DISCUSSION_STATUSES) });

// ---------------------------------------------------------------------------
// Path parameter schemas (mirror courseSlugParamSchema in contracts/catalog)
// ---------------------------------------------------------------------------

export const lessonIdParamSchema = z.uuid();
export const threadIdParamSchema = z.uuid();
export const postIdParamSchema = z.uuid();

export type LessonSummaryDto = z.infer<typeof lessonSummarySchema>;
export type ContinueLearningCardDto = z.infer<typeof continueLearningCardSchema>;
export type LearnerDashboardDto = z.infer<typeof learnerDashboardSchema>;
export type CourseProgressDto = z.infer<typeof courseProgressSchema>;
export type LessonAccessDto = z.infer<typeof lessonAccessSchema>;
export type LessonNoteDto = z.infer<typeof lessonNoteSchema>;
export type DiscussionThreadSummaryDto = z.infer<typeof discussionThreadSummarySchema>;
export type PaginatedThreadsDto = z.infer<typeof paginatedThreadsSchema>;
export type DiscussionPostDto = z.infer<typeof discussionPostSchema>;
export type ThreadDetailDto = z.infer<typeof threadDetailSchema>;
export type ProgressResultDto = z.infer<typeof progressResultSchema>;
