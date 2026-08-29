// Pure, DB-free assessment rules so they stay unit-testable without a
// database. No Date.now(), fetch or queries live here — every decision that
// depends on the clock takes `now` as an explicit parameter.
//
// Trust model reminder (see the schema module comment): the answer key
// (option.isCorrect + question.explanation) may only appear in a learner
// payload AFTER the attempt is submitted. The attempt's questionSnapshot is
// the frozen copy of what the learner answered; live quiz rows may change at
// any time and must never rewrite a recorded attempt.

import { computeProgressPercent } from "@/server/modules/learning/learning.logic";

// ---------------------------------------------------------------------------
// Snapshot shape (frozen server-side JSON on QuizAttempt.questionSnapshot)
// ---------------------------------------------------------------------------

// Type aliases (not interfaces) so the snapshot stays directly assignable to
// Prisma's Json column input — interfaces lack implicit index signatures.

export type QuizSnapshotOption = {
  id: string;
  position: number;
  text: string;
  /** Answer key. Stripped from every pre-submission payload. */
  isCorrect: boolean;
};

export type QuizSnapshotQuestion = {
  /** The QuizQuestion row id at snapshot time. */
  questionId: string;
  position: number;
  prompt: string;
  points: number;
  /** Answer key. Stripped from every pre-submission payload. */
  explanation: string | null;
  options: QuizSnapshotOption[];
};

/** Minimal row shape the services map into a snapshot (quiz + nested options). */
export interface SnapshotSourceQuestion {
  id: string;
  position: number;
  prompt: string;
  points: number;
  explanation: string | null;
  options: readonly { id: string; position: number; text: string; isCorrect: boolean }[];
}

/** Freezes the served quiz (including the answer key) for one attempt. */
export function buildQuestionSnapshot(
  questions: readonly SnapshotSourceQuestion[],
): QuizSnapshotQuestion[] {
  return questions.map((question) => ({
    questionId: question.id,
    position: question.position,
    prompt: question.prompt,
    points: question.points,
    explanation: question.explanation,
    options: question.options.map((option) => ({
      id: option.id,
      position: option.position,
      text: option.text,
      isCorrect: option.isCorrect,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Sanitization (the pre-submission view of quiz questions)
// ---------------------------------------------------------------------------

export interface LearnerQuizOption {
  id: string;
  position: number;
  text: string;
}

export interface LearnerQuizQuestion {
  id: string;
  position: number;
  prompt: string;
  points: number;
  options: LearnerQuizOption[];
}

/**
 * Strips the answer key (option.isCorrect) and the explanation from snapshot
 * or live question rows. This is the ONLY shape learners may see before they
 * submit an attempt.
 */
export function sanitizeQuizQuestions(
  questions: readonly QuizSnapshotQuestion[],
): LearnerQuizQuestion[] {
  return questions.map((question) => ({
    id: question.questionId,
    position: question.position,
    prompt: question.prompt,
    points: question.points,
    options: question.options.map((option) => ({
      id: option.id,
      position: option.position,
      text: option.text,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Scoring from the snapshot
// ---------------------------------------------------------------------------

/** One entry of the submit body (quizSubmitSchema answers[]). */
export interface SubmittedAnswer {
  questionId: string;
  optionId: string | null;
}

/** Verdict for one snapshot question, frozen at submit time. */
export interface ResolvedAnswer {
  questionId: string;
  /** The learner's selection; null when the question was left unanswered. */
  optionId: string | null;
  /** Unanswered questions are never correct. */
  isCorrect: boolean;
}

export interface ScoreSummary {
  scorePoints: number;
  maxPoints: number;
  scorePercent: number;
  passed: boolean;
}

/**
 * Resolves submitted answers against the attempt's snapshot: a missing answer
 * (or an explicit null option, or an option the snapshot does not know) reads
 * as unanswered. Answers pointing at questions outside the snapshot are
 * ignored — the learner answered exactly what the snapshot records.
 */
export function resolveSnapshotAnswers(
  snapshot: readonly QuizSnapshotQuestion[],
  submitted: readonly SubmittedAnswer[],
): ResolvedAnswer[] {
  const byQuestionId = new Map(submitted.map((answer) => [answer.questionId, answer]));
  return snapshot.map((question) => {
    const submittedAnswer = byQuestionId.get(question.questionId);
    const selectedOption =
      submittedAnswer?.optionId != null
        ? question.options.find((option) => option.id === submittedAnswer.optionId)
        : undefined;
    return {
      questionId: question.questionId,
      optionId: selectedOption?.id ?? null,
      isCorrect: selectedOption?.isCorrect === true,
    };
  });
}

/** Points earned from already-resolved answers. */
export function scoreResolvedAnswers(
  snapshot: readonly QuizSnapshotQuestion[],
  resolved: readonly ResolvedAnswer[],
): { scorePoints: number; maxPoints: number } {
  const correctIds = new Set(resolved.filter((answer) => answer.isCorrect).map((a) => a.questionId));
  const scorePoints = snapshot
    .filter((question) => correctIds.has(question.questionId))
    .reduce((sum, question) => sum + question.points, 0);
  const maxPoints = snapshot.reduce((sum, question) => sum + question.points, 0);
  return { scorePoints, maxPoints };
}

/**
 * Server-derived outcome: the percentage is floored exactly like course
 * progress so both surfaces share one rounding rule; passing compares the
 * floored percentage against the quiz's pass threshold.
 */
export function deriveQuizOutcome(
  scorePoints: number,
  maxPoints: number,
  passPercent: number,
): ScoreSummary {
  const scorePercent = computeProgressPercent(scorePoints, maxPoints);
  return {
    scorePoints,
    maxPoints,
    scorePercent,
    passed: scorePercent >= passPercent,
  };
}

/** Rows persisted into QuizAnswer (verdict frozen at submit time). */
export interface QuizAnswerRow {
  questionId: string;
  optionId: string | null;
  isCorrect: boolean;
}

export function toQuizAnswerRows(resolved: readonly ResolvedAnswer[]): QuizAnswerRow[] {
  return resolved.map((answer) => ({
    questionId: answer.questionId,
    optionId: answer.optionId,
    isCorrect: answer.isCorrect,
  }));
}

// ---------------------------------------------------------------------------
// Post-submission review DTO (the answer key is permitted from here on)
// ---------------------------------------------------------------------------

export interface AttemptResultQuestion {
  questionId: string;
  prompt: string;
  points: number;
  explanation: string | null;
  options: (LearnerQuizOption & { isCorrect: boolean })[];
  yourOptionId: string | null;
  isCorrect: boolean;
}

/**
 * Rebuilds the review questions from the attempt's snapshot and its stored
 * verdicts — never from live quiz rows, which the owner may have edited
 * after the attempt was taken.
 */
export function buildAttemptResultQuestions(
  snapshot: readonly QuizSnapshotQuestion[],
  resolved: readonly ResolvedAnswer[],
): AttemptResultQuestion[] {
  const byQuestionId = new Map(resolved.map((answer) => [answer.questionId, answer]));
  return snapshot.map((question) => {
    const answer = byQuestionId.get(question.questionId);
    return {
      questionId: question.questionId,
      prompt: question.prompt,
      points: question.points,
      explanation: question.explanation,
      options: question.options.map((option) => ({
        id: option.id,
        position: option.position,
        text: option.text,
        isCorrect: option.isCorrect,
      })),
      yourOptionId: answer?.optionId ?? null,
      isCorrect: answer?.isCorrect ?? false,
    };
  });
}

// ---------------------------------------------------------------------------
// Attempt lifecycle decisions
// ---------------------------------------------------------------------------

/**
 * Whether the learner may open another attempt. A null maxAttempts means
 * unlimited; every stored attempt (STARTED, SUBMITTED or EXPIRED) consumed a
 * slot, so the used count is simply the number of attempt rows.
 */
export function canStartQuizAttempt(attemptsUsed: number, maxAttempts: number | null): boolean {
  return maxAttempts === null || attemptsUsed < maxAttempts;
}

/** Remaining attempts, or null when the quiz does not cap them. */
export function attemptsRemaining(attemptsUsed: number, maxAttempts: number | null): number | null {
  if (maxAttempts === null) return null;
  return Math.max(0, maxAttempts - attemptsUsed);
}

/** Hard submit deadline for a new attempt, or null when the quiz is untimed. */
export function computeSubmitDeadline(now: Date, timeLimitMinutes: number | null): Date | null {
  if (timeLimitMinutes === null) return null;
  return new Date(now.getTime() + timeLimitMinutes * 60_000);
}

/** Whether an attempt's submit window has closed (null deadline = untimed). */
export function isSubmitDeadlinePassed(submitDeadline: Date | string | null, now: Date): boolean {
  if (submitDeadline === null) return false;
  return new Date(submitDeadline).getTime() < now.getTime();
}

// ---------------------------------------------------------------------------
// Attempt-state derivation (learner quiz view myState)
// ---------------------------------------------------------------------------

/** Scalar shape of one of the caller's attempts on a quiz. */
export interface AttemptStateRow {
  id: string;
  attemptNumber: number;
  status: string;
  createdAt: string;
  submitDeadline: string | null;
  submittedAt: string | null;
  scorePercent: number | null;
  passed: boolean | null;
}

export interface QuizAttemptState {
  attemptsUsed: number;
  attemptsRemaining: number | null;
  bestScorePercent: number | null;
  passed: boolean;
  /** The in-flight (STARTED) attempt to resume; deadline enforcement happens at submit. */
  activeAttempt: {
    id: string;
    attemptNumber: number;
    startedAt: string;
    submitDeadline: string | null;
  } | null;
  latestSubmitted: {
    id: string;
    submittedAt: string;
    scorePercent: number;
    passed: boolean;
  } | null;
}

/**
 * Derives the caller's quiz state from their attempt rows. All rows consume
 * attempt slots; best/passed/latest look only at graded (SUBMITTED) attempts.
 * The STARTED attempt (if any) is surfaced for resume support.
 */
export function deriveQuizAttemptState(
  attempts: readonly AttemptStateRow[],
  maxAttempts: number | null,
): QuizAttemptState {
  const attemptsUsed = attempts.length;
  const submitted = attempts
    .filter((attempt) => attempt.status === "SUBMITTED")
    .sort((a, b) => {
      if (a.submittedAt !== b.submittedAt) {
        return (a.submittedAt ?? "") < (b.submittedAt ?? "") ? 1 : -1;
      }
      return b.attemptNumber - a.attemptNumber;
    });
  const latestSubmitted = submitted[0] ?? null;
  const activeAttempt =
    attempts
      .filter((attempt) => attempt.status === "STARTED")
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0] ?? null;
  const bestScorePercent = submitted.reduce<number | null>(
    (best, attempt) =>
      attempt.scorePercent !== null && (best === null || attempt.scorePercent > best)
        ? attempt.scorePercent
        : best,
    null,
  );

  return {
    attemptsUsed,
    attemptsRemaining: attemptsRemaining(attemptsUsed, maxAttempts),
    bestScorePercent,
    passed: submitted.some((attempt) => attempt.passed === true),
    activeAttempt: activeAttempt
      ? {
          id: activeAttempt.id,
          attemptNumber: activeAttempt.attemptNumber,
          startedAt: activeAttempt.createdAt,
          submitDeadline: activeAttempt.submitDeadline,
        }
      : null,
    latestSubmitted:
      latestSubmitted && latestSubmitted.submittedAt && latestSubmitted.scorePercent !== null
        ? {
            id: latestSubmitted.id,
            submittedAt: latestSubmitted.submittedAt,
            scorePercent: latestSubmitted.scorePercent,
            passed: latestSubmitted.passed === true,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Assignment submission policy
// ---------------------------------------------------------------------------

export type SubmissionBlocker = "DEADLINE_PASSED" | "RESUBMISSION_NOT_ALLOWED";

export interface SubmissionPolicyInput {
  /** ISO timestamp of the evaluation moment. */
  now: string;
  /** ISO deadline from the assignment brief, or null when open-ended. */
  dueAt: string | null;
  submissionsUsed: number;
  allowResubmission: boolean;
  /** Whether the learner's latest submission is still awaiting a grade. */
  hasOpenSubmission: boolean;
}

export interface SubmissionEligibility {
  canSubmit: boolean;
  blocker: SubmissionBlocker | null;
}

/**
 * One decision point shared by the learner view (`canSubmit`) and the create
 * endpoint, so the UI hint can never disagree with the server's verdict:
 * - the deadline (when set) hard-blocks new submissions once `now` is past it;
 * - without resubmission, exactly one submission is ever accepted;
 * - one open (SUBMITTED, not yet graded) submission at a time — RETURNED
 *   submissions are feedback, not an open slot.
 */
export function evaluateSubmissionEligibility(input: SubmissionPolicyInput): SubmissionEligibility {
  if (input.dueAt !== null && input.now > input.dueAt) {
    return { canSubmit: false, blocker: "DEADLINE_PASSED" };
  }
  const usedUp = input.submissionsUsed >= 1;
  if ((usedUp && !input.allowResubmission) || input.hasOpenSubmission) {
    return { canSubmit: false, blocker: "RESUBMISSION_NOT_ALLOWED" };
  }
  return { canSubmit: true, blocker: null };
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/** Scores are non-negative integers bounded by the assignment's maxPoints. */
export function isGradeScoreInRange(score: number, maxPoints: number): boolean {
  return Number.isInteger(score) && score >= 0 && score <= maxPoints;
}
