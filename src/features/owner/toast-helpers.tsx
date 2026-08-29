'use client';

import { toast } from 'sonner';
import type { z } from 'zod';
import { ApiClientError } from '@/lib/client/api-client';

// Shared toast helpers for the owner surfaces. Centralising them keeps the
// error copy consistent between the course table and the course editor.

function DetailList({ details }: { details: { message: string }[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {details.map((detail, index) => (
        <li key={index}>{detail.message}</li>
      ))}
    </ul>
  );
}

/** Publish failures aggregate every failing requirement into `details`. */
export function showPublishBlockedToast(error: ApiClientError): void {
  toast.error(error.message, {
    description:
      error.details && error.details.length > 0 ? (
        <DetailList details={error.details} />
      ) : undefined,
    duration: 10000,
  });
}

/** 401/403 responses get an actionable hint instead of raw API wording. */
export function showActionErrorToast(error: unknown, fallback: string): void {
  if (error instanceof ApiClientError) {
    if (error.code === 'COURSE_NOT_PUBLISHABLE') {
      showPublishBlockedToast(error);
      return;
    }
    if (error.status === 401 || error.status === 403) {
      toast.error('Owner access required', {
        description: 'Sign in with the platform owner account to manage courses.',
      });
      return;
    }
    toast.error(error.message);
    return;
  }
  toast.error(fallback);
}

/** Mirrors the API's validation-error presentation for client-side zod checks. */
export function showValidationIssuesToast(error: z.ZodError, title: string): void {
  toast.error(title, {
    description: (
      <DetailList
        details={error.issues.map((issue) => ({
          message: issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
        }))}
      />
    ),
    duration: 10000,
  });
}
