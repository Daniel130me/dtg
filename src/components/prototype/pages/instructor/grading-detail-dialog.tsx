'use client';

import React, { useEffect, useState } from 'react';
import { ExternalLink, FileCheck, Loader2, RotateCcw, RotateCw, Save, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-mobile';
import { fetchGradingDetail, gradeSubmission, returnSubmission } from '@/features/owner/assessments-api';
import { showActionErrorToast } from '@/features/owner/toast-helpers';
import { ApiClientError } from '@/lib/client/api-client';
import type { GradingDetailDto } from '@/contracts/assessments';
import { GRADE_FEEDBACK_MAX } from '@/contracts/assessments';
import { SUBMISSION_STATUS_BADGES } from './grading-status';

// Full detail + grading form for one submission. Mounted only while open, so
// the load-on-mount effect and the grade form state start fresh per open.
// Shell: centered Dialog on desktop, full-height right Sheet on mobile —
// both render the identical body content via renderBody().

interface GradingDetailDialogProps {
  submissionId: string;
  onClose: () => void;
  /** Fired after a grade is recorded so the parent can refresh its queue row. */
  onGraded: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function GradingDetailDialog({ submissionId, onClose, onGraded }: GradingDetailDialogProps) {
  const isMobile = useIsMobile();

  const [detail, setDetail] = useState<GradingDetailDto | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Grade form (draft-only until recorded).
  const [scoreInput, setScoreInput] = useState('');
  const [feedback, setFeedback] = useState('');
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);

  // "Return for revision" flow (draft-only until confirmed).
  const [returnMode, setReturnMode] = useState(false);
  const [returnFeedback, setReturnFeedback] = useState('');
  const [returning, setReturning] = useState(false);

  // Request-key pattern; refreshing bumps reloadToken so the detail refetches
  // right after a grade is recorded.
  const requestKey = `${submissionId}:${reloadToken}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetchGradingDetail(submissionId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        setLoadError(null);
        setLoadedKey(requestKey);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiClientError
            ? error.message
            : 'Something went wrong while loading the submission.',
        );
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [submissionId, requestKey]);

  const handleRecordGrade = async () => {
    if (!detail || grading) return;

    // Client-side clamp mirroring gradeCreateSchema + the assignment's max.
    const maxPoints = detail.assignment.maxPoints;
    const trimmed = scoreInput.trim();
    const score = Number(trimmed);
    if (trimmed === '' || !Number.isInteger(score) || score < 0 || score > maxPoints) {
      setScoreError(`Score must be a whole number between 0 and ${maxPoints}.`);
      return;
    }
    setScoreError(null);

    setGrading(true);
    try {
      await gradeSubmission(submissionId, {
        score,
        feedback: feedback.trim() === '' ? null : feedback.trim(),
      });
      toast.success('Grade recorded');
      // Refresh BOTH the detail (refetch with fresh history) and the parent
      // queue row (simplest honest option: refetch the queue list).
      setReloadToken((token) => token + 1);
      onGraded();
      setScoreInput('');
      setFeedback('');
    } catch (error) {
      // GRADE_SCORE_OUT_OF_RANGE / SUBMISSION_NOT_FOUND surface via the message.
      showActionErrorToast(error, 'The grade could not be recorded.');
    } finally {
      setGrading(false);
    }
  };

  const handleReturnForRevision = async () => {
    if (!detail || returning) return;
    const trimmed = returnFeedback.trim();
    if (trimmed === '') return;
    setReturning(true);
    try {
      await returnSubmission(submissionId, { feedback: trimmed });
      toast.success('Returned for revision');
      setReturnMode(false);
      setReturnFeedback('');
      setReloadToken((token) => token + 1);
      onGraded();
    } catch (error) {
      // SUBMISSION_NOT_RETURNABLE / SUBMISSION_NOT_FOUND surface via the message.
      showActionErrorToast(error, 'The submission could not be returned.');
    } finally {
      setReturning(false);
    }
  };

  // The shared inner content, rendered identically inside the desktop Dialog
  // and the mobile Sheet. (DialogTitle/DialogDescription are Radix dialog
  // primitives — the same ones SheetContent wraps — so they stay accessible
  // inside either shell.)
  const renderBody = () => {
    if (loading) {
      return (
        <div className="space-y-4">
          <DialogHeader>
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72" />
          </DialogHeader>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    }

    if (loadError || !detail) {
      return (
        <div className="text-center py-10">
          <div className="size-14 mx-auto rounded-full bg-destructive/10 flex items-center justify-center mb-3">
            <FileCheck className="size-6 text-destructive" />
          </div>
          <h3 className="font-semibold mb-1">Could not load this submission</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">{loadError}</p>
          <Button variant="outline" onClick={() => setReloadToken((token) => token + 1)}>
            <RotateCw className="size-4 mr-2" />
            Try again
          </Button>
        </div>
      );
    }

    return (
      <>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            {detail.submission.student.name}
            <Badge className={SUBMISSION_STATUS_BADGES[detail.submission.status].className}>
              {SUBMISSION_STATUS_BADGES[detail.submission.status].label}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {detail.submission.student.email} · {detail.assignment.lessonTitle} ·{' '}
            {detail.assignment.courseTitle} · attempt {detail.submission.attemptNumber} · submitted{' '}
            {formatDate(detail.submission.submittedAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Assignment brief */}
          <section className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assignment instructions
            </h4>
            <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
              {detail.assignment.instructions}
            </div>
          </section>

          {/* Student submission */}
          <section className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Submission (attempt {detail.submission.attemptNumber})
            </h4>
            <div className="rounded-md border p-3 text-sm whitespace-pre-wrap max-h-72 overflow-y-auto custom-scrollbar">
              {detail.submission.body}
            </div>
            {detail.submission.attachmentUrl && (
              <a
                href={detail.submission.attachmentUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline break-all"
              >
                <ExternalLink className="size-3.5 shrink-0" />
                Open attachment
              </a>
            )}
            {detail.submission.status === 'RETURNED' && detail.submission.returnedFeedback && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <Undo2 className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <p className="whitespace-pre-wrap">
                  Returned for revision{detail.submission.returnedAt ? ` · ${formatDateTime(detail.submission.returnedAt)}` : ''}
                  — “{detail.submission.returnedFeedback}”
                </p>
              </div>
            )}
          </section>

          {/* Grade history (ascending) */}
          <section className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Grade history
            </h4>
            {detail.grades.length === 0 ? (
              <p className="text-sm text-muted-foreground">No grades recorded yet.</p>
            ) : (
              <ol className="divide-y rounded-md border">
                {[...detail.grades]
                  .sort((a, b) => a.gradedAt.localeCompare(b.gradedAt))
                  .map((grade) => (
                    <li key={grade.id} className="p-3 space-y-1">
                      <p className="text-sm font-medium">
                        {grade.score}/{grade.maxPoints}{' '}
                        <span className="font-normal text-muted-foreground">
                          · {formatDateTime(grade.gradedAt)}
                          {grade.gradedBy ? ` · by ${grade.gradedBy.name}` : ''}
                        </span>
                      </p>
                      {grade.feedback && (
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {grade.feedback}
                        </p>
                      )}
                    </li>
                  ))}
              </ol>
            )}
          </section>

          {/* Grade form */}
          <section className="space-y-3 border-t pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Record a grade
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-4">
              <div className="space-y-2">
                <Label htmlFor="grade-score">Score (of {detail.assignment.maxPoints})</Label>
                <Input
                  id="grade-score"
                  type="number"
                  min={0}
                  max={detail.assignment.maxPoints}
                  value={scoreInput}
                  placeholder="e.g. 42"
                  onChange={(event) => setScoreInput(event.target.value)}
                  aria-invalid={Boolean(scoreError)}
                />
                {scoreError && (
                  <p id="grade-score-error" className="text-xs text-destructive" role="alert">
                    {scoreError}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="grade-feedback">Feedback (optional)</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {feedback.length}/{GRADE_FEEDBACK_MAX}
                  </span>
                </div>
                <Textarea
                  id="grade-feedback"
                  value={feedback}
                  maxLength={GRADE_FEEDBACK_MAX}
                  rows={3}
                  placeholder="What was good, what to improve..."
                  onChange={(event) => setFeedback(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {detail.submission.status !== 'RETURNED' && !returnMode && (
                <Button
                  variant="outline"
                  onClick={() => setReturnMode(true)}
                  disabled={grading}
                  className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950"
                >
                  <Undo2 className="size-4" />
                  Return for revision
                </Button>
              )}
              {!returnMode && (
                <Button onClick={() => void handleRecordGrade()} disabled={grading}>
                  {grading ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
                  Record grade
                </Button>
              )}
            </div>
            {returnMode && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                <div className="flex items-center justify-between">
                  <Label htmlFor="return-feedback">
                    Revision feedback <span className="text-destructive">*</span>
                  </Label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {returnFeedback.length}/{GRADE_FEEDBACK_MAX}
                  </span>
                </div>
                <Textarea
                  id="return-feedback"
                  value={returnFeedback}
                  maxLength={GRADE_FEEDBACK_MAX}
                  rows={3}
                  placeholder="Tell the learner what to revise..."
                  onChange={(event) => setReturnFeedback(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The learner keeps this attempt as RETURNED and answers with a fresh submission.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReturnMode(false);
                      setReturnFeedback('');
                    }}
                    disabled={returning}
                  >
                    <RotateCcw className="size-3.5 mr-1.5" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300 text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900"
                    onClick={() => void handleReturnForRevision()}
                    disabled={returning || returnFeedback.trim() === ''}
                  >
                    {returning ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Undo2 className="size-3.5 mr-1.5" />}
                    Return submission
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </>
    );
  };

  // Mobile: full-height right sheet (scrolls internally, safe-area bottom).
  if (isMobile) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl p-4 sm:p-6 pb-safe overflow-y-auto custom-scrollbar"
        >
          {renderBody()}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: unchanged centered dialog.
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar">
        {renderBody()}
      </DialogContent>
    </Dialog>
  );
}
