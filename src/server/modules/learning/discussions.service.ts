import { DiscussionStatus, EnrolmentStatus, LessonStatus, Prisma } from "@prisma/client";
import {
  COURSE_NOT_ENROLLED,
  LESSON_NOT_ACCESSIBLE,
  LESSON_NOT_FOUND,
  replyListQuerySchema,
  threadListQuerySchema,
  type DiscussionPostDto,
  type DiscussionStatusValue,
  type DiscussionThreadSummaryDto,
  type PaginatedThreadsDto,
  type ThreadDetailDto,
} from "@/contracts/learning";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import {
  decodeActivityCursor,
  decodeCursor,
  encodeActivityCursor,
  encodeCursor,
} from "@/server/http/pagination";

// Authorization model: learner discussion reads/writes resolve through
// requireAuthenticatedUser(headers); access to a lesson's Q&A is granted by
// the shared assertDiscussionAccess helper below. Owner moderation routes go
// through requireOwner(headers) before reaching setThreadStatus/setPostStatus.

// One select for every thread read: the summary DTO needs the author (the
// user relation) and the lesson title.
const THREAD_SUMMARY_SELECT = {
  id: true,
  lessonId: true,
  title: true,
  status: true,
  postCount: true,
  lastActivityAt: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
  lesson: { select: { title: true } },
} satisfies Prisma.DiscussionThreadSelect;

interface ThreadRowLike {
  id: string;
  lessonId: string;
  title: string;
  status: DiscussionStatus;
  postCount: number;
  lastActivityAt: Date;
  createdAt: Date;
  user: { id: string; name: string };
  lesson: { title: string };
}

const POST_SELECT = {
  id: true,
  body: true,
  status: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.DiscussionPostSelect;

interface PostRowLike {
  id: string;
  body: string;
  status: DiscussionStatus;
  createdAt: Date;
  user: { id: string; name: string };
}

function toThreadSummaryDto(row: ThreadRowLike): DiscussionThreadSummaryDto {
  return {
    id: row.id,
    lessonId: row.lessonId,
    lessonTitle: row.lesson.title,
    title: row.title,
    status: row.status,
    postCount: row.postCount,
    lastActivityAt: row.lastActivityAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    author: row.user,
  };
}

function toPostDto(row: PostRowLike): DiscussionPostDto {
  return {
    id: row.id,
    body: row.body,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    author: row.user,
  };
}

interface LessonForDiscussion {
  courseId: string;
  isPreview: boolean;
}

/**
 * Shared Q&A access rule: enrolled learners (ACTIVE or COMPLETED) always
 * pass; preview-marked lessons are readable by anyone signed in. Used by the
 * thread list, thread detail, and replies so every discussion surface shares
 * one definition of "can see this lesson's Q&A".
 */
async function assertDiscussionAccess(userId: string, lesson: LessonForDiscussion): Promise<void> {
  const enrolment = await db.enrolment.findUnique({
    where: { userId_courseId: { userId, courseId: lesson.courseId } },
    select: { status: true },
  });
  const enrolled =
    enrolment?.status === EnrolmentStatus.ACTIVE || enrolment?.status === EnrolmentStatus.COMPLETED;
  if (!enrolled && !lesson.isPreview) {
    throw new ApiError(422, LESSON_NOT_ACCESSIBLE, "Enroll in the course to join the discussion.");
  }
}

/** Loads a published lesson or fails with the shared learner-facing 404. */
async function loadPublishedLessonForDiscussion(lessonId: string) {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, courseId: true, title: true, status: true, isPreview: true },
  });
  if (!lesson || lesson.status !== LessonStatus.PUBLISHED) {
    throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");
  }
  return lesson;
}

/**
 * A lesson's question threads, newest activity first. Keyset pagination over
 * (lastActivityAt desc, id desc) mirrors the enrolments list exactly.
 * Query budget: 2 (page + total) + 1 access check + 1 lesson load.
 */
export async function listLessonThreads(
  userId: string,
  lessonId: string,
  input: unknown,
): Promise<PaginatedThreadsDto> {
  const query = threadListQuerySchema.parse(input);
  const lesson = await loadPublishedLessonForDiscussion(lessonId);
  await assertDiscussionAccess(userId, lesson);

  const where: Prisma.DiscussionThreadWhereInput = {
    lessonId: lesson.id,
    // Hidden threads vanish from every learner read; the owner console owns
    // moderation, not re-listing.
    status: DiscussionStatus.ACTIVE,
  };
  if (query.cursor) {
    const cursor = decodeActivityCursor(query.cursor);
    const cursorDate = new Date(cursor.lastActivityAt);
    where.AND = [
      {
        OR: [
          { lastActivityAt: { lt: cursorDate } },
          { lastActivityAt: cursorDate, id: { lt: cursor.id } },
        ],
      },
    ];
  }

  const [rows, total] = await Promise.all([
    db.discussionThread.findMany({
      where,
      select: THREAD_SUMMARY_SELECT,
      orderBy: [{ lastActivityAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    db.discussionThread.count({ where }),
  ]);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = items.at(-1);

  return {
    items: items.map(toThreadSummaryDto),
    nextCursor:
      hasMore && lastItem
        ? encodeActivityCursor({
            lastActivityAt: lastItem.lastActivityAt.toISOString(),
            id: lastItem.id,
          })
        : null,
    total,
  };
}

/**
 * Asking a question: the thread row is the question's title/metadata shell,
 * while the body is stored as the thread's opening DiscussionPost — replies
 * and the opening question then share one shape for rendering and moderation.
 * postCount therefore starts at 1 (it includes the opening post).
 */
export async function createThread(
  userId: string,
  lessonId: string,
  input: { title: string; body: string },
  requestId: string,
): Promise<{ thread: DiscussionThreadSummaryDto }> {
  const lesson = await loadPublishedLessonForDiscussion(lessonId);

  // New questions are a participating action: preview readers may browse Q&A
  // (assertDiscussionAccess in the read paths) but must enrol to post one.
  const enrolment = await db.enrolment.findUnique({
    where: { userId_courseId: { userId, courseId: lesson.courseId } },
    select: { status: true },
  });
  const enrolled =
    enrolment?.status === EnrolmentStatus.ACTIVE || enrolment?.status === EnrolmentStatus.COMPLETED;
  if (!enrolled) {
    throw new ApiError(422, COURSE_NOT_ENROLLED, "Enroll in the course to ask questions.");
  }

  const thread = await withTransaction(async (tx) => {
    const created = await tx.discussionThread.create({
      data: {
        lessonId: lesson.id,
        courseId: lesson.courseId,
        userId,
        title: input.title,
        // postCount includes the opening question post (see docstring).
        postCount: 1,
      },
      select: THREAD_SUMMARY_SELECT,
    });

    await tx.discussionPost.create({
      data: { threadId: created.id, userId, body: input.body },
      select: { id: true },
    });

    // Phase 9/10 consumers (moderation digests, notifications) read the
    // outbox; the unique eventKey keeps a retried request from duplicating.
    await tx.outboxEvent.create({
      data: {
        eventKey: `discussion.thread:${created.id}`,
        topic: "discussion.thread_created",
        aggregateType: "DiscussionThread",
        aggregateId: created.id,
        payload: {
          courseId: lesson.courseId,
          lessonId: lesson.id,
          threadId: created.id,
          authorUserId: userId,
        },
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "discussion.thread_created",
        entityType: "DiscussionThread",
        entityId: created.id,
        requestId,
        metadata: { courseId: lesson.courseId, lessonId: lesson.id },
      },
      select: { id: true },
    });

    return created;
  });

  return { thread: toThreadSummaryDto(thread) };
}

/** A hidden thread or a thread on a draft lesson reads as absent (same 404 as
 * a missing id) so learners cannot enumerate either. */
const THREAD_ABSENT_ERROR = () =>
  new ApiError(404, "NOT_FOUND", "The discussion thread was not found.");

/**
 * One thread with its (ascending) reply page. Query budget: 1 (thread) +
 * 2 (post page + total) + 1 access check.
 */
export async function getThread(
  userId: string,
  threadId: string,
  input: unknown,
): Promise<ThreadDetailDto> {
  const query = replyListQuerySchema.parse(input);

  const thread = await db.discussionThread.findUnique({
    where: { id: threadId },
    select: {
      ...THREAD_SUMMARY_SELECT,
      lesson: { select: { title: true, status: true, isPreview: true, courseId: true } },
    },
  });
  if (!thread || thread.status === DiscussionStatus.HIDDEN || thread.lesson.status !== LessonStatus.PUBLISHED) {
    throw THREAD_ABSENT_ERROR();
  }
  await assertDiscussionAccess(userId, thread.lesson);

  const where: Prisma.DiscussionPostWhereInput = { threadId: thread.id, status: DiscussionStatus.ACTIVE };
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    const cursorDate = new Date(cursor.createdAt);
    // Ascending keyset: strictly after the cursor page, not before.
    where.AND = [
      {
        OR: [
          { createdAt: { gt: cursorDate } },
          { createdAt: cursorDate, id: { gt: cursor.id } },
        ],
      },
    ];
  }

  const [rows, totalPosts] = await Promise.all([
    db.discussionPost.findMany({
      where,
      select: POST_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
    }),
    db.discussionPost.count({ where }),
  ]);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = items.at(-1);

  return {
    thread: toThreadSummaryDto(thread),
    posts: items.map(toPostDto),
    nextCursor:
      hasMore && lastItem
        ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
        : null,
    totalPosts,
  };
}

/**
 * Reply to a thread: the post is created, the thread's denormalized counters
 * move (postCount + lastActivityAt), and an outbox event fans out. The
 * thread's postCount is denormalized history — see the moderation docstring
 * for why moderation never rewrites it.
 */
export async function replyToThread(
  userId: string,
  threadId: string,
  input: { body: string },
  requestId: string,
): Promise<{ post: DiscussionPostDto }> {
  const thread = await db.discussionThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      status: true,
      courseId: true,
      lessonId: true,
      lesson: { select: { status: true, isPreview: true, courseId: true } },
    },
  });
  if (!thread || thread.status === DiscussionStatus.HIDDEN || thread.lesson.status !== LessonStatus.PUBLISHED) {
    throw THREAD_ABSENT_ERROR();
  }
  // Same access rule as reading: enrolled learners everywhere, preview
  // lessons open to signed-in readers.
  await assertDiscussionAccess(userId, thread.lesson);

  const post = await withTransaction(async (tx) => {
    const created = await tx.discussionPost.create({
      data: { threadId: thread.id, userId, body: input.body },
      select: POST_SELECT,
    });

    await tx.discussionThread.update({
      where: { id: thread.id },
      data: { postCount: { increment: 1 }, lastActivityAt: new Date() },
      select: { id: true },
    });

    await tx.outboxEvent.create({
      data: {
        eventKey: `discussion.post:${created.id}`,
        topic: "discussion.thread_replied",
        aggregateType: "DiscussionPost",
        aggregateId: created.id,
        payload: {
          threadId: thread.id,
          courseId: thread.courseId,
          lessonId: thread.lessonId,
          authorUserId: userId,
        },
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "discussion.replied",
        entityType: "DiscussionPost",
        entityId: created.id,
        requestId,
        metadata: { threadId: thread.id, courseId: thread.courseId, lessonId: thread.lessonId },
      },
      select: { id: true },
    });

    return created;
  });

  return { post: toPostDto(post) };
}

/**
 * Owner moderation: hiding a thread filters it from every learner read (the
 * learners' lists and detail views filter status ACTIVE). postCount is
 * deliberately left untouched — it is denormalized history of how many posts
 * exist, not a live filter count, so un-hiding restores the exact previous
 * state.
 */
export async function setThreadStatus(
  actorOwnerId: string,
  threadId: string,
  status: DiscussionStatusValue,
  requestId: string,
): Promise<{ thread: DiscussionThreadSummaryDto }> {
  const thread = await db.discussionThread.findUnique({
    where: { id: threadId },
    select: { id: true },
  });
  if (!thread) throw THREAD_ABSENT_ERROR();

  const updated = await withTransaction(async (tx) => {
    const row = await tx.discussionThread.update({
      where: { id: thread.id },
      data: { status },
      select: THREAD_SUMMARY_SELECT,
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actorOwnerId,
        action: "discussion.thread_moderated",
        entityType: "DiscussionThread",
        entityId: thread.id,
        requestId,
        metadata: { status },
      },
      select: { id: true },
    });
    return row;
  });

  return { thread: toThreadSummaryDto(updated) };
}

/** Owner moderation of a single post; hiding only filters that post. */
export async function setPostStatus(
  actorOwnerId: string,
  postId: string,
  status: DiscussionStatusValue,
  requestId: string,
): Promise<{ post: DiscussionPostDto }> {
  const post = await db.discussionPost.findUnique({
    where: { id: postId },
    select: { id: true },
  });
  if (!post) throw new ApiError(404, "NOT_FOUND", "The discussion post was not found.");

  const updated = await withTransaction(async (tx) => {
    const row = await tx.discussionPost.update({
      where: { id: post.id },
      data: { status },
      select: POST_SELECT,
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actorOwnerId,
        action: "discussion.post_moderated",
        entityType: "DiscussionPost",
        entityId: post.id,
        requestId,
        metadata: { status },
      },
      select: { id: true },
    });
    return row;
  });

  return { post: toPostDto(updated) };
}
