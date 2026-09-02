'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Hourglass,
  Loader2,
  Lock,
  PenTool,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { FetchErrorState } from '@/components/prototype/shared/AsyncStates';
import {
  createAssignmentSubmission,
  fetchAssignmentLearnerView,
} from '@/features/learning/assessments-api';
import { ApiClientError } from '@/lib/client/api-client';
import { cn } from '@/lib/utils';
import {
  ASSIGNMENT_ATTACHMENT_URL_MAX,
  ASSIGNMENT_BODY_MAX,
  ASSIGNMENT_DEADLINE_PASSED,
  ASSIGNMENT_NOT_CONFIGURED,
  ASSIGNMENT_RESUBMISSION_NOT_ALLOWED,
  type AssignmentLearnerViewDto,
  type LearnerSubmissionDto,
  type SubmissionStatusValue,
} from '@/contracts/assessments';
import { COURSE_NOT_ENROLLED } from '@/contracts/learning';

/**
 * Lesson assignment for ENROLLED learners (the player gates rendering on
 * access — same pattern as PlayerNotesPanel). Brief card + submit form while
 * allowed, honest amber panels while blocked (deadline passed / awaiting
 * grading / no resubmission), and the full submission history with grades.
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

/** Bodies longer than this get a Show more/less toggle in the history. */
const SUBMISSION_CLAMP_LENGTH = 280;

/** Submission status -> Badge styling. No blue/indigo: house palette only. */
const SUBMISSION_BADGE: Record<
  SubmissionStatusValue,
  { variant: 'secondary' | 'destructive'; className?: string }
> = {
  SUBMITTED: { variant: 'secondary' },
  GRADED: {
    variant: 'secondary',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  },
  RETURNED: { variant: 'destructive' },
};

/** "" -> null (no attachment); a parseable http(s) URL -> normalized; else invalid. */
function parseAttachmentUrl(raw: string): { url: string | null; invalid: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { url: null, invalid: false };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: null, invalid: true };
    }
    return { url: parsed.toString(), invalid: false };
  } catch {
    return { url: null, invalid: true };
  }
}

export interface PlayerAssignmentPanelProps {
  lessonId: string;
  /** Coursera-style completion gate: reported to the player so it can disable
   *  "Mark as complete" until the assignment is submitted (404/none => ungated). */
  onGateChange?: (satisfied: boolean, message: string | null) => void;
  /** Fired once per successful submit so the player can auto-complete the lesson. */
  onComplete?: () => void;
}

export default function PlayerAssignmentPanel({ lessonId, onGateChange, onComplete }: PlayerAssignmentPanelProps) {
  const [view, setView] = useState<AssignmentLearnerViewDto | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [enrollGated, setEnrollGated] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Submit form state (body + optional attachment URL).
  const [body, setBody] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Loading is DERIVED from the request key (house pattern): the effect only
  // writes state inside async callbacks, never synchronously.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [retrySeed, setRetrySeed] = useState(0);
  const requestKey = `${lessonId}#${retrySeed}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchAssignmentLearnerView(lessonId)
      .then((dto) => {
        if (cancelled) return;
        setView(dto);
        // Gate report: an assignment lesson without a configured assignment
        // never blocks completion (same convention as certificate eligibility).
        const submitted = dto.myState.submissions.length > 0;
        onGateChange?.(submitted, submitted ? null : 'Submit the assignment to complete this lesson.');
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (
          err instanceof ApiClientError &&
          err.status === 404 &&
          err.code === ASSIGNMENT_NOT_CONFIGURED
        ) {
          setNotConfigured(true);
          onGateChange?.(true, null);
        } else if (
          err instanceof ApiClientError &&
          (err.code === COURSE_NOT_ENROLLED || err.status === 422 || err.status === 403)
        ) {
          setEnrollGated(true);
        } else {
          setFetchError(err instanceof Error ? err.message : 'Could not load the assignment.');
        }
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, requestKey]);

  /** Event-handler-only resync of the learner view (never from an effect). */
  async function refreshView() {
    try {
      setView(await fetchAssignmentLearnerView(lessonId));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not refresh the assignment.');
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!view || submitting) return;
    const parsed = parseAttachmentUrl(attachmentUrl);
    if (body.trim().length === 0 || parsed.invalid) return;
    setSubmitting(true);
    try {
      await createAssignmentSubmission(lessonId, {
        body: body.trim(),
        attachmentUrl: parsed.url,
      });
      toast.success('Assignment submitted');
      setBody('');
      setAttachmentUrl('');
      // Adopt the server's view so the history + canSubmit reflect reality.
      const dto = await fetchAssignmentLearnerView(lessonId);
      setView(dto);
      // Coursera-style: submitting the assignment completes the lesson.
      onGateChange?.(true, null);
      onComplete?.();
    } catch (err: unknown) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not submit your assignment.',
      );
      if (
        err instanceof ApiClientError &&
        (err.code === ASSIGNMENT_DEADLINE_PASSED ||
          err.code === ASSIGNMENT_RESUBMISSION_NOT_ALLOWED)
      ) {
        // Policy changed under us (deadline raced): render the blocked panel.
        await refreshView();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-28 w-full' />
        <Skeleton className='h-40 w-full' />
        <Skeleton className='h-9 w-40' />
      </div>
    );
  }

  if (notConfigured) {
    return (
      <div className='rounded-lg border bg-muted/30 p-8 text-center text-sm text-muted-foreground'>
        No assignment has been published for this lesson yet.
      </div>
    );
  }

  if (enrollGated) {
    return (
      <div className='flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950'>
        <PenTool className='mt-0.5 size-4 shrink-0 text-amber-600' />
        <p className='text-sm text-amber-800 dark:text-amber-200'>
          Assignments are available after enrolling in the course.
        </p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <FetchErrorState
        title='Could not load the assignment'
        message={fetchError}
        onRetry={() => setRetrySeed((seed) => seed + 1)}
        className='py-10'
      />
    );
  }

  if (!view) return null;

  const { assignment, myState } = view;
  // The "latest" submission is the one with the highest attempt number.
  const latest = myState.submissions.reduce<LearnerSubmissionDto | null>(
    (acc, submission) =>
      !acc || submission.attemptNumber > acc.attemptNumber ? submission : acc,
    null,
  );
  const dueMs = assignment.dueAt ? Date.parse(assignment.dueAt) : null;
  const deadlinePassed = dueMs !== null && Date.now() > dueMs;

  // Why submitting is blocked (only rendered when canSubmit is false).
  let blockedMessage: string | null = null;
  let blockedIcon: React.ReactNode = <Lock className='mt-0.5 size-4 shrink-0 text-amber-600' />;
  if (!myState.canSubmit) {
    if (deadlinePassed) {
      blockedMessage = 'The deadline for this assignment has passed.';
      blockedIcon = <Clock className='mt-0.5 size-4 shrink-0 text-amber-600' />;
    } else if (latest?.status === 'SUBMITTED') {
      blockedMessage = 'Your current submission is awaiting grading.';
      blockedIcon = <Hourglass className='mt-0.5 size-4 shrink-0 text-amber-600' />;
    } else if (!assignment.allowResubmission) {
      blockedMessage = 'Resubmissions are not allowed for this assignment.';
    } else {
      blockedMessage = 'Submissions are closed for this assignment right now.';
    }
  }

  const attachment = parseAttachmentUrl(attachmentUrl);
  const canSubmitForm = !submitting && body.trim().length > 0 && !attachment.invalid;

  return (
    <div className='space-y-4'>
      {/* Brief */}
      <div className='space-y-3 rounded-lg border p-4'>
        <div className='flex items-start gap-3'>
          <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10'>
            <PenTool className='size-5 text-primary' />
          </div>
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-2'>
              <h3 className='text-sm font-semibold'>Assignment</h3>
              <Badge variant='secondary'>{assignment.maxPoints} points max</Badge>
            </div>
            <p
              className={cn(
                'mt-1 flex items-center gap-1.5 text-xs',
                deadlinePassed ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
              )}
            >
              <Clock className='size-3 shrink-0' />
              {assignment.dueAt
                ? `Due ${formatDate(assignment.dueAt)}${deadlinePassed ? ' (passed)' : ''}`
                : 'No deadline'}
            </p>
          </div>
        </div>
        <p className='whitespace-pre-wrap text-sm leading-relaxed'>{assignment.instructions}</p>
        <p className='text-xs text-muted-foreground'>
          {assignment.allowResubmission
            ? 'Resubmissions are allowed — your latest submission is what gets graded.'
            : 'Single submission — resubmissions are not allowed.'}
        </p>
      </div>

      {/* Subtle summaries near the top */}
      {latest?.status === 'GRADED' && latest.latestGrade && (
        <div className='flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'>
          <CheckCircle2 className='mt-0.5 size-4 shrink-0 text-emerald-600' />
          <p>
            Graded — Score: {latest.latestGrade.score}/{latest.latestGrade.maxPoints}{' '}
            <span className='text-xs opacity-80'>({formatDate(latest.latestGrade.gradedAt)})</span>
          </p>
        </div>
      )}
      {latest?.status === 'RETURNED' && (
        <div className='flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'>
          <Undo2 className='mt-0.5 size-4 shrink-0 text-amber-600' />
          <div>
            <p>The instructor returned your submission — revise and resubmit.</p>
            {latest.returnedFeedback && (
              <p className='mt-1 whitespace-pre-wrap rounded-md bg-amber-100/70 p-2 text-xs dark:bg-amber-900/40'>
                “{latest.returnedFeedback}”
              </p>
            )}
          </div>
        </div>
      )}

      {/* Submit form (only while the server allows submissions) */}
      {myState.canSubmit ? (
        <form onSubmit={handleSubmit} className='space-y-3 rounded-lg border p-4'>
          <label htmlFor='assignment-body' className='block text-sm font-medium'>
            Your submission
          </label>
          <Textarea
            id='assignment-body'
            value={body}
            maxLength={ASSIGNMENT_BODY_MAX}
            onChange={(event) => setBody(event.target.value)}
            placeholder='Write your submission...'
            className='min-h-[160px] resize-y'
          />
          <span
            className={cn(
              'block text-right text-xs tabular-nums',
              body.length >= ASSIGNMENT_BODY_MAX ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {body.length}/{ASSIGNMENT_BODY_MAX}
          </span>

          <div className='space-y-1.5'>
            <label htmlFor='assignment-attachment' className='block text-sm font-medium'>
              Attachment URL{' '}
              <span className='font-normal text-muted-foreground'>(optional)</span>
            </label>
            <Input
              id='assignment-attachment'
              type='url'
              value={attachmentUrl}
              maxLength={ASSIGNMENT_ATTACHMENT_URL_MAX}
              onChange={(event) => setAttachmentUrl(event.target.value)}
              placeholder='https://...'
            />
            {attachment.invalid && (
              <p className='text-xs text-destructive'>
                Enter a valid URL starting with http:// or https://.
              </p>
            )}
          </div>

          <div className='flex justify-end'>
            <Button type='submit' size='sm' disabled={!canSubmitForm} className='gap-1.5'>
              {submitting && <Loader2 className='size-3.5 animate-spin' />}
              Submit assignment
            </Button>
          </div>
        </form>
      ) : (
        blockedMessage && (
          <div className='flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950'>
            {blockedIcon}
            <p className='text-sm text-amber-800 dark:text-amber-200'>{blockedMessage}</p>
          </div>
        )
      )}

      {/* Submission history */}
      {myState.submissions.length > 0 && (
        <div className='space-y-2'>
          <h4 className='text-sm font-semibold'>
            Your submissions ({myState.submissionsUsed})
          </h4>
          <div className='max-h-96 space-y-2 overflow-y-auto pr-1'>
            {[...myState.submissions]
              .sort((a, b) => b.attemptNumber - a.attemptNumber)
              .map((submission) => (
                <SubmissionRow key={submission.id} submission={submission} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One history row: attempt meta, status badge, clamped body, grade block. */
function SubmissionRow({ submission }: { submission: LearnerSubmissionDto }) {
  const [expanded, setExpanded] = useState(false);
  const badge = SUBMISSION_BADGE[submission.status];
  const isLong = submission.body.length > SUBMISSION_CLAMP_LENGTH;

  return (
    <div className='space-y-2 rounded-lg border p-3'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='shrink-0 text-xs font-medium'>Attempt #{submission.attemptNumber}</span>
          <Badge variant={badge.variant} className={cn('text-xs', badge.className)}>
            {submission.status}
          </Badge>
        </div>
        <span className='shrink-0 text-xs text-muted-foreground'>
          {formatDate(submission.submittedAt)}
        </span>
      </div>

      <p className={cn('whitespace-pre-wrap text-sm', !expanded && 'line-clamp-4')}>
        {submission.body}
      </p>
      {isLong && (
        <button
          type='button'
          onClick={() => setExpanded((value) => !value)}
          className='text-xs font-medium text-primary hover:underline'
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {submission.attachmentUrl && (
        <a
          href={submission.attachmentUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline'
        >
          <ExternalLink className='size-3' />
          View attachment
        </a>
      )}

      {submission.latestGrade && (
        <div className='space-y-1.5 rounded-md bg-muted/60 p-3'>
          <p className='text-sm font-medium tabular-nums'>
            Score: {submission.latestGrade.score}/{submission.latestGrade.maxPoints}
          </p>
          {submission.latestGrade.feedback && (
            <p className='whitespace-pre-wrap text-sm italic text-muted-foreground'>
              {submission.latestGrade.feedback}
            </p>
          )}
          <p className='text-xs text-muted-foreground'>
            Graded {formatDate(submission.latestGrade.gradedAt)}
          </p>
        </div>
      )}
    </div>
  );
}
