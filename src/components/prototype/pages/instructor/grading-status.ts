import type { SubmissionStatusValue } from '@/contracts/assessments';

// Shared presentation mapping for submission status badges in the grading
// queue and detail dialog. SUBMITTED = neutral, GRADED = emerald tint,
// RETURNED = destructive.

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatusValue, string> = {
  SUBMITTED: 'Submitted',
  GRADED: 'Graded',
  RETURNED: 'Returned',
};

export const SUBMISSION_STATUS_BADGES: Record<SubmissionStatusValue, { label: string; className: string }> = {
  SUBMITTED: {
    label: 'Submitted',
    className: 'bg-muted text-muted-foreground border-0',
  },
  GRADED: {
    label: 'Graded',
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0',
  },
  RETURNED: {
    label: 'Returned',
    className: 'bg-destructive/10 text-destructive border-0',
  },
};
