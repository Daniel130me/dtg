'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, HelpCircle, Loader2, TimerOff, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import {
  fetchQuizAttemptResult,
  fetchQuizLearnerView,
  startQuizAttempt,
  submitQuizAttempt,
} from '@/features/learning/assessments-api';
import { ApiClientError } from '@/lib/client/api-client';
import { cn } from '@/lib/utils';
import {
  QUIZ_ATTEMPT_ALREADY_SUBMITTED,
  QUIZ_ATTEMPT_DEADLINE_PASSED,
  QUIZ_ATTEMPT_LIMIT_REACHED,
  QUIZ_NOT_CONFIGURED,
  type QuizActiveAttemptDto,
  type QuizAttemptResultDto,
  type QuizLearnerViewDto,
  type QuizSubmitInput,
} from '@/contracts/assessments';
import { COURSE_NOT_ENROLLED } from '@/contracts/learning';

/**
 * Lesson quiz for ENROLLED learners (the player gates rendering on access —
 * the same pattern as PlayerNotesPanel). State machine:
 *
 *   loading -> 404 QUIZ_NOT_CONFIGURED -> honest "not published" card
 *           -> 422 COURSE_NOT_ENROLLED  -> enroll message (Q&A panel pattern)
 *           -> other errors             -> FetchErrorState + retry
 *           -> view:
 *                activeAttempt -> attempt form (radio questions + countdown)
 *                else result   -> scored review + retake
 *                else          -> intro card (meta + start attempt)
 */

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** ISO datetime -> "29 Aug 2026" (date-only, matches the rest of the app). */
function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

/** 754 -> "12:34"; 4500 -> "1:15:00" (m:ss / h:mm:ss countdown clock). */
function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Below this much remaining time the countdown turns amber. */
const URGENT_SECONDS = 5 * 60;

type QuizQuestionDto = QuizLearnerViewDto['quiz']['questions'][number];
/** Selected option id per question id; null/absent = unanswered. */
type QuizAnswerMap = Record<string, string | null>;

function seedAnswers(questions: QuizQuestionDto[]): QuizAnswerMap {
  return Object.fromEntries(questions.map((question) => [question.id, null]));
}

/** Every question is submitted, unanswered ones carry a null optionId. */
function buildPayload(questions: QuizQuestionDto[], answers: QuizAnswerMap): QuizSubmitInput {
  return {
    answers: questions.map((question) => ({
      questionId: question.id,
      optionId: answers[question.id] ?? null,
    })),
  };
}

export interface PlayerQuizPanelProps {
  lessonId: string;
  /** Coursera-style completion gate: reported to the player so it can disable
   *  "Mark as complete" until the quiz is passed (404/no-quiz => ungated). */
  onGateChange?: (satisfied: boolean, message: string | null) => void;
  /** Fired once per passing submit so the player can auto-complete the lesson. */
  onComplete?: () => void;
}

export default function PlayerQuizPanel({ lessonId, onGateChange, onComplete }: PlayerQuizPanelProps) {
  const [view, setView] = useState<QuizLearnerViewDto | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<QuizActiveAttemptDto | null>(null);
  const [result, setResult] = useState<QuizAttemptResultDto | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [enrollGated, setEnrollGated] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Pending guards for the start/retake and submit mutations.
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Loading is DERIVED from the request key (house pattern): the effect only
  // writes state inside async callbacks, never synchronously.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);
  const requestKey = `${lessonId}#${retrySeed}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchQuizLearnerView(lessonId)
      .then(async (dto) => {
        // Best-effort review: with no attempt in flight but a submitted one
        // behind us, render its result; if that read fails, the intro card's
        // summary line is the honest fallback.
        let review: QuizAttemptResultDto | null = null;
        if (!dto.myState.activeAttempt && dto.myState.latestSubmitted) {
          review = await fetchQuizAttemptResult(dto.myState.latestSubmitted.id).catch(() => null);
        }
        if (cancelled) return;
        setView(dto);
        setActiveAttempt(dto.myState.activeAttempt);
        setResult(review);
        // Gate report: a quiz lesson without an authored quiz never blocks
        // completion (same convention as certificate eligibility).
        onGateChange?.(dto.myState.passed, dto.myState.passed ? null : 'Pass the quiz to complete this lesson.');
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 404 && err.code === QUIZ_NOT_CONFIGURED) {
          setNotConfigured(true);
          onGateChange?.(true, null);
        } else if (
          err instanceof ApiClientError &&
          (err.code === COURSE_NOT_ENROLLED || err.status === 422 || err.status === 403)
        ) {
          setEnrollGated(true);
        } else {
          setFetchError(err instanceof Error ? err.message : 'Could not load the quiz.');
        }
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, requestKey]);

  /**
   * Re-reads the learner view plus the latest submitted attempt's review.
   * Event-handler/async-callback only (never called from an effect body), so
   * its synchronous setStates are lint-safe.
   */
  async function loadViewData(): Promise<{
    view: QuizLearnerViewDto;
    review: QuizAttemptResultDto | null;
  }> {
    const dto = await fetchQuizLearnerView(lessonId);
    const { activeAttempt: inFlight, latestSubmitted } = dto.myState;
    const review =
      !inFlight && latestSubmitted
        ? await fetchQuizAttemptResult(latestSubmitted.id).catch(() => null)
        : null;
    return { view: dto, review };
  }

  function applyViewData(data: { view: QuizLearnerViewDto; review: QuizAttemptResultDto | null }) {
    setView(data.view);
    setActiveAttempt(data.view.myState.activeAttempt);
    setResult(data.review);
  }

  /** Start (intro) and Retake (result footer) share the same endpoint. */
  async function handleStartAttempt() {
    if (starting || submitting) return;
    setStarting(true);
    try {
      const attempt = await startQuizAttempt(lessonId);
      // Only after success: a failed start keeps the result view on screen.
      setResult(null);
      setActiveAttempt(attempt);
    } catch (err: unknown) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not start the attempt.');
      if (
        err instanceof ApiClientError &&
        (err.code === QUIZ_ATTEMPT_LIMIT_REACHED || err.code === COURSE_NOT_ENROLLED)
      ) {
        // Resync the summary so attempts-left matches the server's truth.
        loadViewData()
          .then(applyViewData)
          .catch(() => undefined);
      }
    } finally {
      setStarting(false);
    }
  }

  async function handleSubmitAttempt(payload: QuizSubmitInput) {
    const attempt = activeAttempt;
    if (!attempt || submitting) return;
    setSubmitting(true);
    try {
      const submitted = await submitQuizAttempt(attempt.id, payload);
      toast.success('Attempt submitted');
      // Coursera-style: a passing attempt completes the lesson automatically.
      if (submitted.passed) {
        onGateChange?.(true, null);
        onComplete?.();
      }
      // Resync myState (attempts left, best score) before showing the result;
      // if the resync fails, still show the fresh result from the submit call.
      const data = await loadViewData().catch(() => null);
      if (data) {
        applyViewData({ view: data.view, review: data.review ?? submitted });
      } else {
        setResult(submitted);
        setActiveAttempt(null);
      }
    } catch (err: unknown) {
      if (
        err instanceof ApiClientError &&
        (err.code === QUIZ_ATTEMPT_DEADLINE_PASSED || err.code === QUIZ_ATTEMPT_ALREADY_SUBMITTED)
      ) {
        // The attempt is closed server-side (deadline raced, or a second tab
        // submitted it): drop the form and render the authoritative state.
        toast.error(err.message);
        const data = await loadViewData().catch(() => null);
        if (data) applyViewData(data);
      } else {
        toast.error(
          err instanceof ApiClientError ? err.message : 'Could not submit your attempt.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  /** Manual fallback for the expired panel when auto-refresh also failed. */
  async function handleExpiredReload() {
    try {
      applyViewData(await loadViewData());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not refresh the quiz.');
    }
  }

  if (loading) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-16 w-5/6' />
        <Skeleton className='h-9 w-36' />
      </div>
    );
  }

  if (notConfigured) {
    return (
      <div className='rounded-lg border bg-muted/30 p-8 text-center text-sm text-muted-foreground'>
        No quiz has been published for this lesson yet.
      </div>
    );
  }

  if (enrollGated) {
    return (
      <div className='flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950'>
        <HelpCircle className='mt-0.5 size-4 shrink-0 text-amber-600' />
        <p className='text-sm text-amber-800 dark:text-amber-200'>
          Quizzes are available after enrolling in the course.
        </p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <FetchErrorState
        title='Could not load the quiz'
        message={fetchError}
        onRetry={() => setRetrySeed((seed) => seed + 1)}
        className='py-10'
      />
    );
  }

  if (activeAttempt) {
    // key: a fresh attempt remounts the form so answers/timer start clean.
    return (
      <QuizAttemptForm
        key={activeAttempt.id}
        attempt={activeAttempt}
        submitting={submitting}
        onSubmit={handleSubmitAttempt}
        onReload={handleExpiredReload}
      />
    );
  }

  if (result && view) {
    return (
      <QuizResultView
        result={result}
        attemptsRemaining={view.myState.attemptsRemaining}
        retaking={starting}
        onRetake={handleStartAttempt}
      />
    );
  }

  if (!view) return null;

  const { quiz, myState } = view;
  const totalPoints = quiz.questions.reduce((sum, question) => sum + question.points, 0);
  const attemptsExhausted = myState.attemptsRemaining === 0;

  // Intro card: quiz meta + start (reached when there is no attempt in flight
  // and no result to show — including the review-fetch-failed fallback).
  return (
    <Card className='gap-0 space-y-4 p-5'>
      <div className='flex items-start gap-3'>
        <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10'>
          <HelpCircle className='size-5 text-primary' />
        </div>
        <div className='min-w-0 flex-1'>
          <h3 className='text-sm font-semibold'>Course quiz</h3>
          <p className='mt-0.5 text-sm text-muted-foreground'>
            {quiz.questions.length} {quiz.questions.length === 1 ? 'question' : 'questions'} ·{' '}
            {totalPoints} {totalPoints === 1 ? 'point' : 'points'} · single choice
          </p>
        </div>
      </div>

      <Separator />

      <dl className='grid grid-cols-2 gap-x-4 gap-y-2 text-sm'>
        <dt className='text-muted-foreground'>Pass score</dt>
        <dd className='text-right font-medium tabular-nums'>{quiz.passPercent}%</dd>
        <dt className='text-muted-foreground'>Attempts</dt>
        <dd className='text-right font-medium tabular-nums'>
          {myState.attemptsRemaining === null
            ? 'Unlimited attempts'
            : `${myState.attemptsUsed} of ${myState.attemptsUsed + myState.attemptsRemaining} attempts`}
        </dd>
        <dt className='text-muted-foreground'>Time limit</dt>
        <dd className='text-right font-medium'>
          {quiz.timeLimitMinutes ? `${quiz.timeLimitMinutes} minute limit` : 'No time limit'}
        </dd>
        <dt className='text-muted-foreground'>Best score</dt>
        <dd className='flex items-center justify-end gap-2'>
          <span className='font-medium tabular-nums'>
            {myState.bestScorePercent !== null ? `${myState.bestScorePercent}%` : '—'}
          </span>
          {myState.passed && (
            <Badge className='bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'>
              Passed
            </Badge>
          )}
        </dd>
      </dl>

      {/* Fallback when the review read failed but an attempt exists. */}
      {myState.latestSubmitted && (
        <div className='rounded-lg bg-muted/50 p-3 text-sm'>
          Latest attempt:{' '}
          <span className='font-medium tabular-nums'>{myState.latestSubmitted.scorePercent}%</span>{' '}
          —{' '}
          <span
            className={cn(
              'font-medium',
              myState.latestSubmitted.passed
                ? 'text-emerald-700 dark:text-emerald-300'
                : 'text-rose-700 dark:text-rose-300',
            )}
          >
            {myState.latestSubmitted.passed ? 'Passed' : 'Not passed'}
          </span>
          <span className='text-muted-foreground'>
            {' '}
            · {formatDate(myState.latestSubmitted.submittedAt)}
          </span>
        </div>
      )}

      <div className='space-y-2'>
        <Button
          onClick={handleStartAttempt}
          disabled={starting || attemptsExhausted}
          className='w-full gap-1.5 sm:w-auto'
        >
          {starting && <Loader2 className='size-4 animate-spin' />}
          {myState.attemptsUsed > 0 ? 'Start new attempt' : 'Start attempt'}
        </Button>
        {attemptsExhausted && (
          <p className='text-xs text-muted-foreground'>
            You have used all of your attempts for this quiz.
          </p>
        )}
        {quiz.timeLimitMinutes && !attemptsExhausted && (
          <p className='text-xs text-muted-foreground'>
            The timer starts as soon as you begin and cannot be paused.
          </p>
        )}
      </div>
    </Card>
  );
}

// --- Attempt form ------------------------------------------------------------

/**
 * One in-flight attempt: snapshot questions as radio groups, a live countdown
 * when the attempt has a deadline, and auto-submit when it expires. Remounted
 * per attempt (keyed by attempt id), so answers/timer never leak across tries.
 */
function QuizAttemptForm({
  attempt,
  submitting,
  onSubmit,
  onReload,
}: {
  attempt: QuizActiveAttemptDto;
  submitting: boolean;
  onSubmit: (payload: QuizSubmitInput) => void;
  onReload: () => void;
}) {
  const questions = attempt.questions;
  const [answers, setAnswers] = useState<QuizAnswerMap>(() => seedAnswers(questions));
  // The countdown re-renders once per second via this counter; the actual
  // remaining time is always derived from the deadline at render time.
  const [tick, setTick] = useState(0);
  const autoSubmittedRef = useRef(false);

  const deadlineMs = attempt.submitDeadline ? Date.parse(attempt.submitDeadline) : null;
  const secondsLeft =
    deadlineMs !== null ? Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)) : null;
  const timeUp = secondsLeft !== null && secondsLeft <= 0;
  const unanswered = questions.filter((question) => !answers[question.id]).length;

  useEffect(() => {
    if (deadlineMs === null) return;
    const interval = setInterval(() => {
      setTick((value) => value + 1);
      // Auto-submit exactly once when the deadline passes; same submit path as
      // the button (the parent owns the pending guard and error handling).
      if (Date.now() >= deadlineMs && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true;
        onSubmit(buildPayload(questions, answers));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [deadlineMs, onSubmit, questions, answers]);

  function handleSubmitClick() {
    onSubmit(buildPayload(questions, answers));
  }

  // Expired: the server closes the attempt at the deadline; while the
  // auto-submit round-trip runs we show a spinner, afterwards an honest panel.
  if (timeUp) {
    return (
      <div className='flex flex-col items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-8 text-center dark:border-amber-900 dark:bg-amber-950'>
        {submitting ? (
          <>
            <Loader2 className='size-6 animate-spin text-amber-600' />
            <p className='text-sm font-medium text-amber-800 dark:text-amber-200'>
              Submitting your attempt…
            </p>
          </>
        ) : (
          <>
            <TimerOff className='size-6 text-amber-600' />
            <div>
              <p className='text-sm font-medium text-amber-800 dark:text-amber-200'>
                Time is up for this attempt.
              </p>
              <p className='mt-1 text-xs text-amber-700/80 dark:text-amber-300/80'>
                Your answers were not submitted before the deadline.
              </p>
            </div>
            <Button variant='outline' size='sm' onClick={onReload}>
              Reload quiz
            </Button>
          </>
        )}
      </div>
    );
  }

  const urgent = secondsLeft !== null && secondsLeft <= URGENT_SECONDS;

  return (
    <div className='space-y-4' data-tick={tick}>
      {secondsLeft !== null && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border p-3 text-sm',
            urgent
              ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'
              : 'border-border bg-muted/40',
          )}
        >
          <Clock className='size-4 shrink-0' />
          <span>Time remaining:</span>
          <span role='timer' aria-live='off' className='font-semibold tabular-nums'>
            {formatCountdown(secondsLeft)}
          </span>
        </div>
      )}

      <div className='space-y-3'>
        {questions.map((question, index) => (
          <fieldset
            key={question.id}
            disabled={submitting}
            className='space-y-3 rounded-lg border p-4'
          >
            <legend className='px-1.5 text-xs font-medium text-muted-foreground'>
              Question {index + 1} of {questions.length} · {question.points}{' '}
              {question.points === 1 ? 'pt' : 'pts'}
            </legend>
            <p className='text-sm font-medium'>{question.prompt}</p>
            <RadioGroup
              value={answers[question.id] ?? ''}
              onValueChange={(value) =>
                setAnswers((prev) => ({ ...prev, [question.id]: value }))
              }
              className='gap-2'
            >
              {question.options.map((option) => (
                <label
                  key={option.id}
                  className='flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-3 text-sm transition-colors hover:bg-muted/40 has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5'
                >
                  <RadioGroupItem value={option.id} className='shrink-0' />
                  <span className='flex-1'>{option.text}</span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
        ))}
      </div>

      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2'>
        <p
          className={cn(
            'text-xs',
            unanswered > 0
              ? 'font-medium text-amber-700 dark:text-amber-300'
              : 'text-muted-foreground',
          )}
        >
          {unanswered > 0 ? `Unanswered: ${unanswered}` : 'All questions answered'}
        </p>
        <Button onClick={handleSubmitClick} disabled={submitting} className='gap-1.5'>
          {submitting && <Loader2 className='size-4 animate-spin' />}
          Submit attempt
        </Button>
      </div>
    </div>
  );
}

// --- Result / review ----------------------------------------------------------

/**
 * Scored review of one submitted attempt: headline, per-question breakdown
 * with the correct answer highlighted, and a retake action when attempts are
 * left (always shown when the quiz allows unlimited attempts).
 */
function QuizResultView({
  result,
  attemptsRemaining,
  retaking,
  onRetake,
}: {
  result: QuizAttemptResultDto;
  attemptsRemaining: number | null;
  retaking: boolean;
  onRetake: () => void;
}) {
  const canRetake = attemptsRemaining === null || attemptsRemaining > 0;

  return (
    <div className='space-y-4'>
      <div
        className={cn(
          'rounded-lg border p-4',
          result.passed
            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950'
            : 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950',
        )}
      >
        <div className='flex items-start gap-3'>
          {result.passed ? (
            <CheckCircle2 className='mt-0.5 size-5 shrink-0 text-emerald-600' />
          ) : (
            <XCircle className='mt-0.5 size-5 shrink-0 text-rose-600' />
          )}
          <div className='min-w-0 flex-1'>
            <p
              className={cn(
                'text-sm font-semibold',
                result.passed
                  ? 'text-emerald-800 dark:text-emerald-200'
                  : 'text-rose-800 dark:text-rose-200',
              )}
            >
              You scored {result.scorePoints}/{result.maxPoints} ({result.scorePercent}%) —{' '}
              {result.passed ? 'Passed ✓' : `Not passed (needs ${result.passPercent}%)`}
            </p>
            <p
              className={cn(
                'mt-1 text-xs',
                result.passed
                  ? 'text-emerald-700/80 dark:text-emerald-300/80'
                  : 'text-rose-700/80 dark:text-rose-300/80',
              )}
            >
              Attempt {result.attemptNumber} · submitted {formatDate(result.submittedAt)}
            </p>
          </div>
        </div>
      </div>

      <div className='space-y-3'>
        {result.questions.map((question, index) => (
          <div key={question.questionId} className='space-y-3 rounded-lg border p-4'>
            <div className='flex items-start justify-between gap-3'>
              <p className='min-w-0 text-sm font-medium'>
                {index + 1}. {question.prompt}
              </p>
              <Badge
                variant={question.isCorrect ? 'secondary' : 'outline'}
                className={cn(
                  'shrink-0 tabular-nums',
                  question.isCorrect &&
                    'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
                )}
              >
                {question.isCorrect ? question.points : 0}/{question.points}{' '}
                {question.points === 1 ? 'pt' : 'pts'}
              </Badge>
            </div>

            {question.yourOptionId === null && (
              <p className='text-xs italic text-muted-foreground'>
                You did not answer this question.
              </p>
            )}

            <div className='space-y-1.5'>
              {question.options.map((option) => {
                const isYours = option.id === question.yourOptionId;
                if (option.isCorrect) {
                  return (
                    <div
                      key={option.id}
                      className='flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-sm dark:border-emerald-900 dark:bg-emerald-950'
                    >
                      <CheckCircle2 className='size-4 shrink-0 text-emerald-600' />
                      <span className='min-w-0 flex-1'>{option.text}</span>
                      {isYours && (
                        <span className='shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-300'>
                          Your answer
                        </span>
                      )}
                    </div>
                  );
                }
                if (isYours) {
                  return (
                    <div
                      key={option.id}
                      className='flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-2.5 text-sm dark:border-rose-900 dark:bg-rose-950'
                    >
                      <XCircle className='size-4 shrink-0 text-rose-600' />
                      <span className='min-w-0 flex-1'>{option.text}</span>
                      <span className='shrink-0 text-xs font-medium text-rose-700 dark:text-rose-300'>
                        Your answer
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={option.id}
                    className='flex items-center gap-2 rounded-md border p-2.5 text-sm text-muted-foreground'
                  >
                    <span aria-hidden className='size-4 shrink-0' />
                    <span className='min-w-0 flex-1'>{option.text}</span>
                  </div>
                );
              })}
            </div>

            {question.explanation && (
              <div className='rounded-md bg-muted/60 p-3 text-xs text-muted-foreground'>
                <span className='font-medium text-foreground'>Explanation: </span>
                {question.explanation}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className='flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between'>
        <p className='text-xs text-muted-foreground'>
          {attemptsRemaining === null
            ? 'Unlimited attempts — retake to improve your score.'
            : attemptsRemaining > 0
              ? `${attemptsRemaining} ${attemptsRemaining === 1 ? 'attempt' : 'attempts'} remaining.`
              : 'You have used every attempt for this quiz.'}
        </p>
        {canRetake && (
          <Button
            size='sm'
            variant='outline'
            onClick={onRetake}
            disabled={retaking}
            className='gap-1.5'
          >
            {retaking && <Loader2 className='size-3.5 animate-spin' />}
            Retake attempt
          </Button>
        )}
      </div>
    </div>
  );
}
