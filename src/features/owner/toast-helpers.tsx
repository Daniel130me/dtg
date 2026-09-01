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

function friendlyValidationMessage(issue: z.ZodIssue): string {
  const path = issue.path.map(String);
  const message = issue.message;
  const field = path.at(-1);
  const sectionIndex = path.indexOf('curriculum');
  const lessonIndex = path.indexOf('lessons');

  if (sectionIndex >= 0 && lessonIndex >= 0 && field === 'title') {
    const lessonNumber = Number(path[lessonIndex + 1]) + 1;
    return `Lesson ${lessonNumber}: add a title with at least 3 characters.`;
  }
  if (field === 'description' && message.includes('50')) {
    return 'Course description: add a little more detail (at least 50 characters) so students know what to expect.';
  }
  if (field === 'shortDescription') {
    return 'Short description: write at least 10 characters about what students will learn.';
  }
  if (field === 'title') {
    return 'Course title: add a clear title with at least 4 characters.';
  }
  if (field === 'categoryId') return 'Category: choose a category for this course.';
  if (field === 'level') return 'Level: choose the level that best matches this course.';
  return message;
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
          message: issue.path.length > 0 ? friendlyValidationMessage(issue) : issue.message,
        }))}
      />
    ),
    duration: 10000,
  });
}
