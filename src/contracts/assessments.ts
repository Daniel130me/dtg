import { z } from "zod";

// ---------------------------------------------------------------------------
// Named constants (no magic values). Limits mirror the Prisma VarChar sizes.
// ---------------------------------------------------------------------------

export const QUIZ_PROMPT_MAX = 1000;
export const QUIZ_OPTION_TEXT_MAX = 500;
export const QUIZ_EXPLANATION_MAX = 2000;
export const QUIZ_POINTS_MAX = 100;
export const QUIZ_QUESTIONS_MIN = 1;
export const QUIZ_OPTIONS_MIN = 2;
export const QUIZ_OPTIONS_MAX = 8;
export const QUIZ_PASS_PERCENT_MIN = 1;
export const QUIZ_PASS_PERCENT_MAX = 100;
export const QUIZ_MAX_ATTEMPTS_MAX = 100;
export const QUIZ_TIME_LIMIT_MAX_MINUTES = 600;

export const ASSIGNMENT_INSTRUCTIONS_MAX = 10000;
export const ASSIGNMENT_BODY_MAX = 20000;
export const ASSIGNMENT_MAX_POINTS_MAX = 1000;
export const ASSIGNMENT_ATTACHMENT_URL_MAX = 2048;

export const GRADE_FEEDBACK_MAX = 5000;

/** Bounded reads: page size for the owner grading queue. */
export const GRADING_QUEUE_LIMIT_DEFAULT = 20;
export const GRADING_QUEUE_LIMIT_MAX = 50;

/** Client-safe tuples mirroring the Prisma enums. */
export const QUIZ_ATTEMPT_STATUSES = ["STARTED", "SUBMITTED", "EXPIRED"] as const;
export type QuizAttemptStatusValue = (typeof QUIZ_ATTEMPT_STATUSES)[number];

export const SUBMISSION_STATUSES = ["SUBMITTED", "GRADED", "RETURNED"] as const;
export type SubmissionStatusValue = (typeof SUBMISSION_STATUSES)[number];

/** Client-matchable error codes shared by server and client. */
export const QUIZ_NOT_CONFIGURED = "QUIZ_NOT_CONFIGURED";
export const QUIZ_ATTEMPT_LIMIT_REACHED = "QUIZ_ATTEMPT_LIMIT_REACHED";
export const QUIZ_ATTEMPT_ALREADY_SUBMITTED = "QUIZ_ATTEMPT_ALREADY_SUBMITTED";
export const QUIZ_ATTEMPT_DEADLINE_PASSED = "QUIZ_ATTEMPT_DEADLINE_PASSED";
export const QUIZ_ATTEMPT_NOT_FOUND = "QUIZ_ATTEMPT_NOT_FOUND";
export const QUIZ_AUTHORING_INVALID = "QUIZ_AUTHORING_INVALID";
export const ASSIGNMENT_NOT_CONFIGURED = "ASSIGNMENT_NOT_CONFIGURED";
export const ASSIGNMENT_DEADLINE_PASSED = "ASSIGNMENT_DEADLINE_PASSED";
export const ASSIGNMENT_RESUBMISSION_NOT_ALLOWED = "ASSIGNMENT_RESUBMISSION_NOT_ALLOWED";
export const SUBMISSION_NOT_FOUND = "SUBMISSION_NOT_FOUND";
export const GRADE_SCORE_OUT_OF_RANGE = "GRADE_SCORE_OUT_OF_RANGE";

// ---------------------------------------------------------------------------
// Query contracts
// ---------------------------------------------------------------------------

export const gradingQueueQuerySchema = z.object({
  courseId: z.uuid().optional(),
  status: z.enum(SUBMISSION_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(GRADING_QUEUE_LIMIT_MAX)
    .default(GRADING_QUEUE_LIMIT_DEFAULT),
});

// ---------------------------------------------------------------------------
// Authoring contracts (owner only; the answer key lives in these payloads)
// ---------------------------------------------------------------------------

export const quizAuthoringInputSchema = z
  .object({
    passPercent: z.number().int().min(QUIZ_PASS_PERCENT_MIN).max(QUIZ_PASS_PERCENT_MAX),
    maxAttempts: z.number().int().min(1).max(QUIZ_MAX_ATTEMPTS_MAX).nullable(),
    timeLimitMinutes: z.number().int().min(1).max(QUIZ_TIME_LIMIT_MAX_MINUTES).nullable(),
    questions: z
      .array(
        z.object({
          prompt: z.string().trim().min(1).max(QUIZ_PROMPT_MAX),
          points: z.number().int().min(1).max(QUIZ_POINTS_MAX),
          explanation: z.string().trim().max(QUIZ_EXPLANATION_MAX).nullable(),
          options: z
            .array(
              z.object({
                text: z.string().trim().min(1).max(QUIZ_OPTION_TEXT_MAX),
                isCorrect: z.boolean(),
              }),
            )
            .min(QUIZ_OPTIONS_MIN)
            .max(QUIZ_OPTIONS_MAX),
        }),
      )
      .min(QUIZ_QUESTIONS_MIN),
  })
  // Single-choice quizzes: a question with no correct option can never be
  // passed, which would silently brick certificate eligibility.
  .refine(
    (input) => input.questions.every((question) => question.options.some((option) => option.isCorrect)),
    { message: "Every question needs at least one correct option." },
  );

export const quizAuthoringSchema = quizAuthoringInputSchema.extend({
  id: z.uuid(),
  lessonId: z.uuid(),
  version: z.number().int().min(1),
});

export const assignmentAuthoringInputSchema = z.object({
  instructions: z.string().trim().min(1).max(ASSIGNMENT_INSTRUCTIONS_MAX),
  maxPoints: z.number().int().min(1).max(ASSIGNMENT_MAX_POINTS_MAX),
  dueAt: z.iso.datetime().nullable(),
  allowResubmission: z.boolean(),
});

export const assignmentAuthoringSchema = assignmentAuthoringInputSchema.extend({
  id: z.uuid(),
  lessonId: z.uuid(),
});

// ---------------------------------------------------------------------------
// Learner quiz contracts. Pre-submission payloads NEVER carry isCorrect or
// explanation (the answer key); both appear only in the post-submission
// review result.
// ---------------------------------------------------------------------------

const learnerQuizOptionSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  text: z.string(),
});

const learnerQuizQuestionSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  prompt: z.string(),
  points: z.number().int().min(1),
  options: z.array(learnerQuizOptionSchema),
});

export const quizLearnerViewSchema = z.object({
  lesson: z.object({ id: z.uuid(), title: z.string() }),
  quiz: z.object({
    id: z.uuid(),
    passPercent: z.number().int(),
    maxAttempts: z.number().int().nullable(),
    timeLimitMinutes: z.number().int().nullable(),
    questions: z.array(learnerQuizQuestionSchema),
  }),
  myState: z.object({
    attemptsUsed: z.number().int().nonnegative(),
    attemptsRemaining: z.number().int().nonnegative().nullable(),
    bestScorePercent: z.number().int().min(0).max(100).nullable(),
    passed: z.boolean(),
    // An in-flight attempt is resumed automatically; its questions come from
    // the attempt's immutable snapshot (sanitized), not the live quiz.
    activeAttempt: z
      .object({
        id: z.uuid(),
        attemptNumber: z.number().int().min(1),
        startedAt: z.iso.datetime(),
        submitDeadline: z.iso.datetime().nullable(),
        questions: z.array(learnerQuizQuestionSchema),
      })
      .nullable(),
    latestSubmitted: z
      .object({
        id: z.uuid(),
        submittedAt: z.iso.datetime(),
        scorePercent: z.number().int().min(0).max(100),
        passed: z.boolean(),
      })
      .nullable(),
  }),
});

/** Body of POST /learning/quiz/attempts/{attemptId}/submit. */
export const quizSubmitSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(64),
        optionId: z.string().min(1).max(64).nullable(),
      }),
    )
    .max(QUIZ_OPTIONS_MAX * 100),
});

export const quizAttemptResultQuestionSchema = z.object({
  questionId: z.string(),
  prompt: z.string(),
  points: z.number().int().min(1),
  explanation: z.string().nullable(),
  // Correctness is permitted here: the attempt is already submitted.
  options: z.array(learnerQuizOptionSchema.extend({ isCorrect: z.boolean() })),
  yourOptionId: z.string().nullable(),
  isCorrect: z.boolean(),
});

export const quizAttemptResultSchema = z.object({
  id: z.uuid(),
  attemptNumber: z.number().int().min(1),
  status: z.literal("SUBMITTED"),
  submittedAt: z.iso.datetime(),
  scorePoints: z.number().int().nonnegative(),
  maxPoints: z.number().int().positive(),
  scorePercent: z.number().int().min(0).max(100),
  passed: z.boolean(),
  passPercent: z.number().int().min(1).max(QUIZ_PASS_PERCENT_MAX),
  questions: z.array(quizAttemptResultQuestionSchema),
});

// ---------------------------------------------------------------------------
// Learner assignment contracts
// ---------------------------------------------------------------------------

export const submissionCreateSchema = z.object({
  body: z.string().trim().min(1).max(ASSIGNMENT_BODY_MAX),
  attachmentUrl: z.string().url().max(ASSIGNMENT_ATTACHMENT_URL_MAX).nullable(),
});

export const learnerSubmissionSchema = z.object({
  id: z.uuid(),
  attemptNumber: z.number().int().min(1),
  status: z.enum(SUBMISSION_STATUSES),
  body: z.string(),
  attachmentUrl: z.string().nullable(),
  submittedAt: z.iso.datetime(),
  latestGrade: z
    .object({
      score: z.number().int().nonnegative(),
      maxPoints: z.number().int().positive(),
      feedback: z.string().nullable(),
      gradedAt: z.iso.datetime(),
    })
    .nullable(),
});

export const assignmentLearnerViewSchema = z.object({
  lesson: z.object({ id: z.uuid(), title: z.string() }),
  assignment: z.object({
    id: z.uuid(),
    instructions: z.string(),
    maxPoints: z.number().int().positive(),
    dueAt: z.iso.datetime().nullable(),
    allowResubmission: z.boolean(),
  }),
  myState: z.object({
    submissionsUsed: z.number().int().nonnegative(),
    canSubmit: z.boolean(),
    submissions: z.array(learnerSubmissionSchema),
  }),
});

// ---------------------------------------------------------------------------
// Owner grading contracts
// ---------------------------------------------------------------------------

const gradingStudentSchema = z.object({ id: z.uuid(), name: z.string(), email: z.string() });

export const gradingQueueItemSchema = z.object({
  id: z.uuid(),
  assignmentId: z.uuid(),
  lessonTitle: z.string(),
  courseTitle: z.string(),
  courseSlug: z.string(),
  student: gradingStudentSchema,
  attemptNumber: z.number().int().min(1),
  status: z.enum(SUBMISSION_STATUSES),
  submittedAt: z.iso.datetime(),
  latestScore: z.number().int().nonnegative().nullable(),
  maxPoints: z.number().int().positive(),
});

export const paginatedGradingQueueSchema = z.object({
  items: z.array(gradingQueueItemSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

export const gradingDetailSchema = z.object({
  submission: z.object({
    id: z.uuid(),
    attemptNumber: z.number().int().min(1),
    status: z.enum(SUBMISSION_STATUSES),
    body: z.string(),
    attachmentUrl: z.string().nullable(),
    submittedAt: z.iso.datetime(),
    student: gradingStudentSchema,
  }),
  assignment: z.object({
    id: z.uuid(),
    instructions: z.string(),
    maxPoints: z.number().int().positive(),
    dueAt: z.iso.datetime().nullable(),
    allowResubmission: z.boolean(),
    lessonTitle: z.string(),
    courseTitle: z.string(),
  }),
  grades: z.array(
    z.object({
      id: z.uuid(),
      score: z.number().int().nonnegative(),
      maxPoints: z.number().int().positive(),
      feedback: z.string().nullable(),
      gradedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
      gradedAt: z.iso.datetime(),
    }),
  ),
});

export const gradeCreateSchema = z.object({
  score: z.number().int().min(0),
  feedback: z.string().trim().max(GRADE_FEEDBACK_MAX).nullable(),
});

// ---------------------------------------------------------------------------
// Path parameter schemas
// ---------------------------------------------------------------------------

export const quizAttemptIdParamSchema = z.uuid();
export const submissionIdParamSchema = z.uuid();

export type QuizAuthoringInput = z.infer<typeof quizAuthoringInputSchema>;
export type QuizAuthoringDto = z.infer<typeof quizAuthoringSchema>;
export type AssignmentAuthoringInput = z.infer<typeof assignmentAuthoringInputSchema>;
export type AssignmentAuthoringDto = z.infer<typeof assignmentAuthoringSchema>;
export type QuizLearnerViewDto = z.infer<typeof quizLearnerViewSchema>;
export type QuizSubmitInput = z.infer<typeof quizSubmitSchema>;
export type QuizAttemptResultDto = z.infer<typeof quizAttemptResultSchema>;
export type SubmissionCreateInput = z.infer<typeof submissionCreateSchema>;
export type LearnerSubmissionDto = z.infer<typeof learnerSubmissionSchema>;
export type AssignmentLearnerViewDto = z.infer<typeof assignmentLearnerViewSchema>;
export type GradingQueueItemDto = z.infer<typeof gradingQueueItemSchema>;
export type PaginatedGradingQueueDto = z.infer<typeof paginatedGradingQueueSchema>;
export type GradingDetailDto = z.infer<typeof gradingDetailSchema>;
export type GradeCreateInput = z.infer<typeof gradeCreateSchema>;
