import type { QuizAuthoringDto, QuizAuthoringInput, AssignmentAuthoringDto, AssignmentAuthoringInput } from "@/contracts/assessments";
import { QUIZ_AUTHORING_INVALID } from "@/contracts/assessments";
import { LESSON_NOT_FOUND } from "@/contracts/learning";
import { LessonType, Prisma } from "@prisma/client";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";

// Authorization model: /api/v1/owner routes resolve the caller through
// requireOwner(headers) before reaching this service — every function here
// trusts that the actor is the platform owner and only validates the lesson.

/**
 * The authoring singleton contract: 200 with `{ quiz: QuizAuthoringDto | null }`
 * (same for assignments). A configured quiz is returned even when its lesson is
 * still a draft — the owner console is the only consumer and edits pre-publish.
 */

// Local code for the assignment flavour of the same authoring mistake; the
// contract only names the quiz variant (QUIZ_AUTHORING_INVALID).
const ASSIGNMENT_AUTHORING_INVALID = "ASSIGNMENT_AUTHORING_INVALID";

const QUIZ_WITH_QUESTIONS_SELECT = {
  id: true,
  lessonId: true,
  version: true,
  passPercent: true,
  maxAttempts: true,
  timeLimitMinutes: true,
  questions: {
    orderBy: { position: "asc" as const },
    select: {
      prompt: true,
      points: true,
      explanation: true,
      options: { orderBy: { position: "asc" as const }, select: { text: true, isCorrect: true } },
    },
  },
} satisfies Prisma.QuizSelect;

function toQuizAuthoringDto(quiz: {
  id: string;
  lessonId: string;
  version: number;
  passPercent: number;
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  questions: {
    prompt: string;
    points: number;
    explanation: string | null;
    options: { text: string; isCorrect: boolean }[];
  }[];
}): QuizAuthoringDto {
  return {
    id: quiz.id,
    lessonId: quiz.lessonId,
    version: quiz.version,
    passPercent: quiz.passPercent,
    maxAttempts: quiz.maxAttempts,
    timeLimitMinutes: quiz.timeLimitMinutes,
    questions: quiz.questions.map((question) => ({
      prompt: question.prompt,
      points: question.points,
      explanation: question.explanation,
      options: question.options.map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
    })),
  };
}

function toAssignmentAuthoringDto(assignment: {
  id: string;
  lessonId: string;
  instructions: string;
  maxPoints: number;
  dueAt: Date | null;
  allowResubmission: boolean;
}): AssignmentAuthoringDto {
  return {
    id: assignment.id,
    lessonId: assignment.lessonId,
    instructions: assignment.instructions,
    maxPoints: assignment.maxPoints,
    dueAt: assignment.dueAt?.toISOString() ?? null,
    allowResubmission: assignment.allowResubmission,
  };
}

// ---------------------------------------------------------------------------
// Quiz authoring
// ---------------------------------------------------------------------------

/**
 * Owner view of a lesson's quiz, answer key included.
 * Query budget: 2 (lesson, quiz with nested questions/options).
 */
export async function getQuizAuthoring(lessonId: string): Promise<{ quiz: QuizAuthoringDto | null }> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, select: { id: true } });
  if (!lesson) throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");

  const quiz = await db.quiz.findUnique({
    where: { lessonId },
    select: QUIZ_WITH_QUESTIONS_SELECT,
  });
  return { quiz: quiz ? toQuizAuthoringDto(quiz) : null };
}

/**
 * Replaces (or creates) a lesson's quiz in one transaction. Existing questions
 * are deleted and recreated, so question/option ids change on every save —
 * published attempts are unaffected because they answered their frozen
 * snapshot, never the live rows. Version bumps on update, starts at 1.
 * Query budget: 2 reads (lesson, existing quiz) + tx writes + 1 re-read.
 */
export async function putQuizAuthoring(
  ownerId: string,
  lessonId: string,
  input: QuizAuthoringInput,
  requestId: string,
): Promise<{ quiz: QuizAuthoringDto }> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, courseId: true, type: true },
  });
  if (!lesson) throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");
  // 404 is reserved for a missing lesson; a type mismatch is an authoring
  // mistake the owner console can highlight.
  if (lesson.type !== LessonType.QUIZ) {
    throw new ApiError(422, QUIZ_AUTHORING_INVALID, "Quizzes can only be configured on QUIZ lessons.");
  }

  const existing = await db.quiz.findUnique({
    where: { lessonId },
    select: { id: true, version: true },
  });

  const quiz = await withTransaction(async (tx) => {
    if (existing) {
      // Recreate is the contract: options may be added/removed/reordered, so
      // patching rows in place would leave stale positions behind. Positions
      // are simply the array order of the authoring payload.
      await tx.quizQuestion.deleteMany({ where: { quizId: existing.id } });
      await tx.quiz.update({
        where: { id: existing.id },
        data: {
          passPercent: input.passPercent,
          maxAttempts: input.maxAttempts,
          timeLimitMinutes: input.timeLimitMinutes,
          version: { increment: 1 },
          questions: {
            create: input.questions.map((question, index) => ({
              position: index,
              prompt: question.prompt,
              points: question.points,
              explanation: question.explanation,
              options: {
                create: question.options.map((option, optionIndex) => ({
                  position: optionIndex,
                  text: option.text,
                  isCorrect: option.isCorrect,
                })),
              },
            })),
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: ownerId,
          action: "quiz.updated",
          entityType: "Quiz",
          entityId: existing.id,
          requestId,
          metadata: { lessonId, courseId: lesson.courseId, version: existing.version + 1 },
        },
        select: { id: true },
      });
    } else {
      const created = await tx.quiz.create({
        data: {
          lessonId,
          courseId: lesson.courseId,
          passPercent: input.passPercent,
          maxAttempts: input.maxAttempts,
          timeLimitMinutes: input.timeLimitMinutes,
          questions: {
            create: input.questions.map((question, index) => ({
              position: index,
              prompt: question.prompt,
              points: question.points,
              explanation: question.explanation,
              options: {
                create: question.options.map((option, optionIndex) => ({
                  position: optionIndex,
                  text: option.text,
                  isCorrect: option.isCorrect,
                })),
              },
            })),
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: ownerId,
          action: "quiz.created",
          entityType: "Quiz",
          entityId: created.id,
          requestId,
          metadata: { lessonId, courseId: lesson.courseId },
        },
        select: { id: true },
      });
    }

    // Re-read inside the transaction so the response matches the committed
    // state (including the bumped version) without duplicating the mapping.
    const saved = await tx.quiz.findUnique({
      where: { lessonId },
      select: QUIZ_WITH_QUESTIONS_SELECT,
    });
    if (!saved) throw new ApiError(500, "INTERNAL_ERROR", "The quiz could not be saved.");
    return saved;
  });

  return { quiz: toQuizAuthoringDto(quiz) };
}

/**
 * Idempotent detach: deleting an absent quiz still answers 200. Deleting the
 * Quiz row cascades to its attempts (schema-level onDelete: Cascade), so the
 * attempt history for a detached quiz disappears with it — accepted by the
 * schema design and documented here rather than silently relied upon.
 * Query budget: 1 read (lesson) + tx { deleteMany + optional audit }.
 */
export async function deleteQuizAuthoring(
  ownerId: string,
  lessonId: string,
  requestId: string,
): Promise<{ quiz: null }> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, select: { id: true } });
  if (!lesson) throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");

  await withTransaction(async (tx) => {
    const deleted = await tx.quiz.deleteMany({ where: { lessonId } });
    // Only a state change is audited; repeated idempotent deletes stay quiet.
    if (deleted.count > 0) {
      await tx.auditLog.create({
        data: {
          actorUserId: ownerId,
          action: "quiz.deleted",
          entityType: "Quiz",
          entityId: lessonId,
          requestId,
          metadata: { lessonId },
        },
        select: { id: true },
      });
    }
  });

  return { quiz: null };
}

// ---------------------------------------------------------------------------
// Assignment authoring
// ---------------------------------------------------------------------------

/**
 * Owner view of a lesson's assignment brief.
 * Query budget: 2 (lesson, assignment).
 */
export async function getAssignmentAuthoring(
  lessonId: string,
): Promise<{ assignment: AssignmentAuthoringDto | null }> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, select: { id: true } });
  if (!lesson) throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");

  const assignment = await db.assignment.findUnique({ where: { lessonId } });
  return { assignment: assignment ? toAssignmentAuthoringDto(assignment) : null };
}

/**
 * Upserts the assignment brief. `dueAt` arrives as an ISO string from the
 * contract and is stored as a Date. No version column — the brief is a live
 * document, unlike the quiz whose question ids rotate on save.
 * Query budget: 2 reads (lesson, existing assignment) + tx { upsert + audit }.
 */
export async function putAssignmentAuthoring(
  ownerId: string,
  lessonId: string,
  input: AssignmentAuthoringInput,
  requestId: string,
): Promise<{ assignment: AssignmentAuthoringDto }> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, courseId: true, type: true },
  });
  if (!lesson) throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");
  if (lesson.type !== LessonType.ASSIGNMENT) {
    throw new ApiError(
      422,
      ASSIGNMENT_AUTHORING_INVALID,
      "Assignments can only be configured on ASSIGNMENT lessons.",
    );
  }

  const data = {
    instructions: input.instructions,
    maxPoints: input.maxPoints,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    allowResubmission: input.allowResubmission,
  };

  const existing = await db.assignment.findUnique({
    where: { lessonId },
    select: { id: true },
  });

  const assignment = await withTransaction(async (tx) => {
    const saved = await tx.assignment.upsert({
      where: { lessonId },
      create: { lessonId, courseId: lesson.courseId, ...data },
      update: data,
    });
    await tx.auditLog.create({
      data: {
        actorUserId: ownerId,
        action: existing ? "assignment.updated" : "assignment.created",
        entityType: "Assignment",
        entityId: saved.id,
        requestId,
        metadata: { lessonId, courseId: lesson.courseId },
      },
      select: { id: true },
    });
    return saved;
  });

  return { assignment: toAssignmentAuthoringDto(assignment) };
}

/**
 * Idempotent detach of the assignment brief; submissions/grades cascade with
 * the Assignment row per the schema.
 * Query budget: 1 read (lesson) + tx { deleteMany + optional audit }.
 */
export async function deleteAssignmentAuthoring(
  ownerId: string,
  lessonId: string,
  requestId: string,
): Promise<{ assignment: null }> {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, select: { id: true } });
  if (!lesson) throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");

  await withTransaction(async (tx) => {
    const deleted = await tx.assignment.deleteMany({ where: { lessonId } });
    if (deleted.count > 0) {
      await tx.auditLog.create({
        data: {
          actorUserId: ownerId,
          action: "assignment.deleted",
          entityType: "Assignment",
          entityId: lessonId,
          requestId,
          metadata: { lessonId },
        },
        select: { id: true },
      });
    }
  });

  return { assignment: null };
}
