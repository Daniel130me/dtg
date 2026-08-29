import { z } from "zod";
import { Prisma, QuizAttemptStatus, EnrolmentStatus, LessonStatus } from "@prisma/client";
import {
  QUIZ_ATTEMPT_ALREADY_SUBMITTED,
  QUIZ_ATTEMPT_DEADLINE_PASSED,
  QUIZ_ATTEMPT_LIMIT_REACHED,
  QUIZ_ATTEMPT_NOT_FOUND,
  QUIZ_NOT_CONFIGURED,
  type QuizAttemptResultDto,
  type QuizLearnerViewDto,
  type QuizSubmitInput,
} from "@/contracts/assessments";
import { COURSE_NOT_ENROLLED, LESSON_NOT_FOUND } from "@/contracts/learning";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import {
  buildAttemptResultQuestions,
  buildQuestionSnapshot,
  canStartQuizAttempt,
  computeSubmitDeadline,
  deriveQuizAttemptState,
  deriveQuizOutcome,
  isSubmitDeadlinePassed,
  resolveSnapshotAnswers,
  sanitizeQuizQuestions,
  scoreResolvedAnswers,
  toQuizAnswerRows,
  type QuizSnapshotQuestion,
} from "@/server/modules/assessments/assessments.logic";

// Authorization model: /api/v1/learning routes resolve the caller through
// requireAuthenticatedUser(headers); every attempt query is pinned to that
// user id, so a caller can only ever start, submit or review their own
// attempts. Course access requires an ACTIVE/COMPLETED enrolment — previews
// never expose assessments.

/**
 * The answer key never reaches a learner payload before submission: the view
 * and start responses serve sanitized questions only, and the review result
 * (which may carry isCorrect/explanation) is rebuilt from the attempt's
 * frozen snapshot, never from live quiz rows.
 */

// A submitted attempt cannot be re-reviewed as "not submitted" — the contract
// has no dedicated code for the GET-review-before-submit case, so this stays
// a local code with a clear message (contract codes remain authoritative
// where they exist).
const QUIZ_ATTEMPT_NOT_SUBMITTED = "QUIZ_ATTEMPT_NOT_SUBMITTED";

/** Runtime guard for the server-written questionSnapshot JSON column. */
const questionSnapshotSchema: z.ZodType<QuizSnapshotQuestion[]> = z.array(
  z.object({
    questionId: z.string(),
    position: z.number().int(),
    prompt: z.string(),
    points: z.number().int(),
    explanation: z.string().nullable(),
    options: z.array(
      z.object({
        id: z.string(),
        position: z.number().int(),
        text: z.string(),
        isCorrect: z.boolean(),
      }),
    ),
  }),
);

function parseQuestionSnapshot(value: Prisma.JsonValue): QuizSnapshotQuestion[] {
  const parsed = questionSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    // The snapshot is only ever written by startQuizAttempt; reaching this
    // means database corruption, not caller input.
    throw new ApiError(500, "INTERNAL_ERROR", "The attempt's question snapshot is unreadable.");
  }
  return parsed.data;
}

function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Loads a published lesson or fails with the shared learner-facing 404. */
async function loadPublishedLesson(lessonId: string) {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, title: true, courseId: true, status: true },
  });
  if (!lesson || lesson.status !== LessonStatus.PUBLISHED) {
    throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");
  }
  return lesson;
}

/** Assessments live inside the classroom: preview lessons do not open them. */
async function assertEnrolled(userId: string, courseId: string): Promise<void> {
  const enrolment = await db.enrolment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { status: true },
  });
  const enrolled =
    enrolment?.status === EnrolmentStatus.ACTIVE || enrolment?.status === EnrolmentStatus.COMPLETED;
  if (!enrolled) {
    throw new ApiError(422, COURSE_NOT_ENROLLED, "Enroll in the course to take this assessment.");
  }
}

/** The lesson's quiz with live question/option rows, or the 404 gate code. */
async function loadQuizForLesson(lessonId: string) {
  const quiz = await db.quiz.findUnique({
    where: { lessonId },
    select: {
      id: true,
      passPercent: true,
      maxAttempts: true,
      timeLimitMinutes: true,
      questions: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          prompt: true,
          points: true,
          explanation: true,
          options: { orderBy: { position: "asc" }, select: { id: true, position: true, text: true, isCorrect: true } },
        },
      },
    },
  });
  if (!quiz) {
    // A published QUIZ lesson without an authored quiz reads as "not set up".
    throw new ApiError(404, QUIZ_NOT_CONFIGURED, "No quiz has been configured for this lesson.");
  }
  return quiz;
}

/** Active-attempt response shape (mirrors myState.activeAttempt in the contract). */
export type QuizActiveAttemptDto = NonNullable<
  QuizLearnerViewDto["myState"]["activeAttempt"]
>;

const ACTIVE_ATTEMPT_SELECT = {
  id: true,
  attemptNumber: true,
  createdAt: true,
  submitDeadline: true,
  questionSnapshot: true,
} satisfies Prisma.QuizAttemptSelect;

type ActiveAttemptRow = Prisma.QuizAttemptGetPayload<{ select: typeof ACTIVE_ATTEMPT_SELECT }>;

function toActiveAttemptDto(row: ActiveAttemptRow): QuizActiveAttemptDto {
  return {
    id: row.id,
    attemptNumber: row.attemptNumber,
    startedAt: row.createdAt.toISOString(),
    submitDeadline: row.submitDeadline?.toISOString() ?? null,
    questions: sanitizeQuizQuestions(parseQuestionSnapshot(row.questionSnapshot)),
  };
}

// ---------------------------------------------------------------------------
// Learner quiz view
// ---------------------------------------------------------------------------

/**
 * Sanitized quiz structure plus the caller's attempt state. The in-flight
 * (STARTED) attempt is auto-resumed: its questions come from its snapshot,
 * not the live quiz, so an owner edit mid-attempt cannot change the paper.
 *
 * Query budget: 5 (lesson, enrolment, quiz+questions, the caller's attempt
 * scalar rows, the active attempt's snapshot row).
 */
export async function getQuizLearnerView(userId: string, lessonId: string): Promise<QuizLearnerViewDto> {
  const lesson = await loadPublishedLesson(lessonId);
  await assertEnrolled(userId, lesson.courseId);
  const quiz = await loadQuizForLesson(lessonId);

  const attemptRows = await db.quizAttempt.findMany({
    where: { quizId: quiz.id, userId },
    orderBy: { attemptNumber: "asc" },
    select: {
      id: true,
      attemptNumber: true,
      status: true,
      createdAt: true,
      submitDeadline: true,
      submittedAt: true,
      scorePercent: true,
      passed: true,
    },
  });
  const activeRow = await db.quizAttempt.findFirst({
    where: { quizId: quiz.id, userId, status: QuizAttemptStatus.STARTED },
    orderBy: { attemptNumber: "desc" },
    select: ACTIVE_ATTEMPT_SELECT,
  });

  // One pure derivation for best/passed/active/latest so the tested logic is
  // exactly the code that serves the view.
  const myState = deriveQuizAttemptState(
    attemptRows.map((row) => ({
      id: row.id,
      attemptNumber: row.attemptNumber,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      submitDeadline: row.submitDeadline?.toISOString() ?? null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      scorePercent: row.scorePercent,
      passed: row.passed,
    })),
    quiz.maxAttempts,
  );

  return {
    lesson: { id: lesson.id, title: lesson.title },
    quiz: {
      id: quiz.id,
      passPercent: quiz.passPercent,
      maxAttempts: quiz.maxAttempts,
      timeLimitMinutes: quiz.timeLimitMinutes,
      // Live rows are normalized through the snapshot builder then stripped to
      // the learner shape — one code path for both sources.
      questions: sanitizeQuizQuestions(buildQuestionSnapshot(quiz.questions)),
    },
    myState: {
      ...myState,
      activeAttempt: activeRow ? toActiveAttemptDto(activeRow) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Start attempt
// ---------------------------------------------------------------------------

/**
 * Opens a new attempt — or transparently resumes the caller's in-flight one
 * (same 201 envelope, so the client needs no special resume branch).
 *
 * Concurrency: attemptNumber is computed from a count, so two simultaneous
 * starts can target the same (quizId, userId, attemptNumber). The unique
 * constraint arbitrates: the loser retries once with a fresh count, and if
 * that still collides, resumes the racing request's STARTED attempt instead
 * of opening another slot.
 *
 * Start is resumable and deliberately un-audited (nothing changed that the
 * learner cannot redo); the submit step carries the audit trail.
 *
 * Query budget: 4 reads (lesson, enrolment, quiz, count) + the create and at
 * most one retry/fallback fetch.
 */
export async function startQuizAttempt(
  userId: string,
  lessonId: string,
): Promise<{ attempt: QuizActiveAttemptDto }> {
  const lesson = await loadPublishedLesson(lessonId);
  await assertEnrolled(userId, lesson.courseId);
  const quiz = await loadQuizForLesson(lessonId);
  const now = new Date();

  // Resume first: a STARTED attempt is the learner's open paper, regardless
  // of the attempt limit (it already consumed its slot when created).
  const existing = await findActiveAttempt(quiz.id, userId);
  if (existing) return { attempt: toActiveAttemptDto(existing) };

  const attemptsUsed = await db.quizAttempt.count({ where: { quizId: quiz.id, userId } });
  if (!canStartQuizAttempt(attemptsUsed, quiz.maxAttempts)) {
    throw new ApiError(
      422,
      QUIZ_ATTEMPT_LIMIT_REACHED,
      "No attempts remain for this quiz.",
    );
  }

  // The snapshot freezes the served paper including the answer key; deadline
  // comes from the quiz's time limit at start time.
  const snapshot = buildQuestionSnapshot(quiz.questions);
  const createAttempt = (attemptNumber: number) =>
    db.quizAttempt.create({
      data: {
        quizId: quiz.id,
        courseId: lesson.courseId,
        userId,
        attemptNumber,
        questionSnapshot: snapshot,
        submitDeadline: computeSubmitDeadline(now, quiz.timeLimitMinutes),
      },
      select: ACTIVE_ATTEMPT_SELECT,
    });

  let attempt: ActiveAttemptRow;
  try {
    attempt = await createAttempt(attemptsUsed + 1);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lost the attemptNumber race: recompute and retry once.
    try {
      const recount = await db.quizAttempt.count({ where: { quizId: quiz.id, userId } });
      attempt = await createAttempt(recount + 1);
    } catch (retryError) {
      if (!isUniqueViolation(retryError)) throw retryError;
      // Still colliding means the racing request holds a STARTED attempt —
      // resume it rather than opening yet another slot.
      const inFlight = await findActiveAttempt(quiz.id, userId);
      if (!inFlight) {
        throw new ApiError(409, "CONFLICT", "The attempt could not be started, please retry.");
      }
      attempt = inFlight;
    }
  }

  return { attempt: toActiveAttemptDto(attempt) };
}

function findActiveAttempt(quizId: string, userId: string) {
  return db.quizAttempt.findFirst({
    where: { quizId, userId, status: QuizAttemptStatus.STARTED },
    orderBy: { attemptNumber: "desc" },
    select: ACTIVE_ATTEMPT_SELECT,
  });
}

// ---------------------------------------------------------------------------
// Submit attempt
// ---------------------------------------------------------------------------

/**
 * Atomic submit: the status flip is a guarded updateMany WHERE status=STARTED,
 * so exactly one request wins; concurrent or repeated submits read as 422.
 * Scoring happens against the attempt's snapshot — an owner editing the quiz
 * mid-flight cannot change the paper or the key.
 *
 * Query budget: 1 (attempt+quiz) + optional deadline flip + tx { updateMany,
 * createMany answers, audit }.
 */
export async function submitQuizAttempt(
  userId: string,
  attemptId: string,
  input: QuizSubmitInput,
  requestId: string,
): Promise<QuizAttemptResultDto> {
  const now = new Date();
  const attempt = await db.quizAttempt.findFirst({
    where: { id: attemptId, userId },
    select: {
      id: true,
      quizId: true,
      courseId: true,
      attemptNumber: true,
      status: true,
      submitDeadline: true,
      questionSnapshot: true,
      quiz: { select: { passPercent: true } },
    },
  });
  if (!attempt) {
    // Ownership-pinned: another user's attempt reads as absent.
    throw new ApiError(404, QUIZ_ATTEMPT_NOT_FOUND, "The quiz attempt was not found.");
  }
  if (attempt.status !== QuizAttemptStatus.STARTED) {
    throw new ApiError(
      422,
      QUIZ_ATTEMPT_ALREADY_SUBMITTED,
      "This attempt is no longer open for submission.",
    );
  }

  // Expired window: park the attempt as EXPIRED (so it can never be submitted
  // later) and refuse. The guarded flip tolerates concurrent late submits.
  if (isSubmitDeadlinePassed(attempt.submitDeadline, now)) {
    await db.quizAttempt.updateMany({
      where: { id: attempt.id, userId, status: QuizAttemptStatus.STARTED },
      data: { status: QuizAttemptStatus.EXPIRED },
    });
    throw new ApiError(422, QUIZ_ATTEMPT_DEADLINE_PASSED, "The attempt's time limit has passed.");
  }

  const snapshot = parseQuestionSnapshot(attempt.questionSnapshot);
  const resolved = resolveSnapshotAnswers(snapshot, input.answers);
  const { scorePoints, maxPoints } = scoreResolvedAnswers(snapshot, resolved);
  const outcome = deriveQuizOutcome(scorePoints, maxPoints, attempt.quiz.passPercent);

  return withTransaction(async (tx) => {
    // The concurrency gate: Postgres re-evaluates status=STARTED after the
    // row lock wait, so a racing duplicate submit observes count 0.
    const flipped = await tx.quizAttempt.updateMany({
      where: { id: attempt.id, userId, status: QuizAttemptStatus.STARTED },
      data: {
        status: QuizAttemptStatus.SUBMITTED,
        submittedAt: now,
        scorePoints: outcome.scorePoints,
        maxPoints: outcome.maxPoints,
        scorePercent: outcome.scorePercent,
        passed: outcome.passed,
      },
    });
    if (flipped.count === 0) {
      throw new ApiError(422, QUIZ_ATTEMPT_ALREADY_SUBMITTED, "This attempt was already submitted.");
    }

    // One row per snapshot question. The (attemptId, questionId) unique plus
    // the gate above already guarantee a single insert; skipDuplicates only
    // degrades a freak replay to a no-op instead of a 409.
    await tx.quizAnswer.createMany({
      data: toQuizAnswerRows(resolved).map((row) => ({ attemptId: attempt.id, ...row })),
      skipDuplicates: true,
    });

    // Only winning submits reach this line, so the audit is exactly-once.
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "quiz.attempt_submitted",
        entityType: "QuizAttempt",
        entityId: attempt.id,
        requestId,
        metadata: {
          quizId: attempt.quizId,
          courseId: attempt.courseId,
          attemptNumber: attempt.attemptNumber,
          scorePercent: outcome.scorePercent,
          passed: outcome.passed,
        },
      },
      select: { id: true },
    });

    return {
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      status: "SUBMITTED" as const,
      submittedAt: now.toISOString(),
      scorePoints: outcome.scorePoints,
      maxPoints: outcome.maxPoints,
      scorePercent: outcome.scorePercent,
      passed: outcome.passed,
      passPercent: attempt.quiz.passPercent,
      // Review rebuilds from the snapshot + fresh verdicts, never live rows.
      questions: buildAttemptResultQuestions(snapshot, resolved),
    };
  });
}

// ---------------------------------------------------------------------------
// Review attempt
// ---------------------------------------------------------------------------

/**
 * Post-submission review: the only learner surface where isCorrect and
 * explanation are permitted, rebuilt from the frozen snapshot and the stored
 * verdict rows so later quiz edits cannot rewrite history.
 *
 * Query budget: 2 (attempt+quiz, answer rows).
 */
export async function getQuizAttemptResult(userId: string, attemptId: string): Promise<QuizAttemptResultDto> {
  const attempt = await db.quizAttempt.findFirst({
    where: { id: attemptId, userId },
    select: {
      id: true,
      attemptNumber: true,
      status: true,
      submittedAt: true,
      scorePoints: true,
      maxPoints: true,
      scorePercent: true,
      passed: true,
      questionSnapshot: true,
      quiz: { select: { passPercent: true } },
    },
  });
  if (!attempt) {
    throw new ApiError(404, QUIZ_ATTEMPT_NOT_FOUND, "The quiz attempt was not found.");
  }
  if (
    attempt.status !== QuizAttemptStatus.SUBMITTED ||
    attempt.submittedAt === null ||
    attempt.scorePercent === null ||
    attempt.scorePoints === null ||
    attempt.maxPoints === null
  ) {
    throw new ApiError(
      422,
      QUIZ_ATTEMPT_NOT_SUBMITTED,
      "The attempt has not been submitted yet.",
    );
  }

  const [answerRows, snapshot] = await Promise.all([
    db.quizAnswer.findMany({
      where: { attemptId: attempt.id },
      select: { questionId: true, optionId: true, isCorrect: true },
    }),
    Promise.resolve(parseQuestionSnapshot(attempt.questionSnapshot)),
  ]);

  // The stored rows ARE the frozen verdicts — no re-resolution against
  // anything that could have changed since submit.
  const resolved = answerRows.map((row) => ({
    questionId: row.questionId,
    optionId: row.optionId,
    isCorrect: row.isCorrect,
  }));

  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: "SUBMITTED" as const,
    submittedAt: attempt.submittedAt.toISOString(),
    scorePoints: attempt.scorePoints,
    maxPoints: attempt.maxPoints,
    scorePercent: attempt.scorePercent,
    passed: attempt.passed === true,
    passPercent: attempt.quiz.passPercent,
    questions: buildAttemptResultQuestions(snapshot, resolved),
  };
}
