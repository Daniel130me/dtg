// Pure, DB-free learning rules so they stay unit-testable without a database.
// The server services own the queries; this module owns every decision that
// is worth testing (percent math, access matrix, next-lesson choice, course
// completion gate, ordering helpers, notes export rendering).

import type { LessonAccessLevel } from "@/contracts/learning";

// ---------------------------------------------------------------------------
// Progress math
// ---------------------------------------------------------------------------

/**
 * Percentage of completed lessons, floored and clamped to 0..100. A course
 * with no lessons is 0% complete, never NaN.
 */
export function computeProgressPercent(completedLessons: number, totalLessons: number): number {
  if (totalLessons <= 0) return 0;
  const percent = Math.floor((completedLessons / totalLessons) * 100);
  return Math.min(100, Math.max(0, percent));
}

/**
 * A course counts as completed when every publishable lesson is done. The
 * total>0 guard prevents an empty course from flipping an enrolment to
 * COMPLETED on its first lesson tick.
 */
export function shouldCompleteCourse(completedLessons: number, totalLessons: number): boolean {
  return totalLessons > 0 && completedLessons >= totalLessons;
}

// ---------------------------------------------------------------------------
// Lesson access
// ---------------------------------------------------------------------------

export interface LessonAccessInput {
  /** The caller's enrolment status in the lesson's course (null = none). */
  enrolmentStatus: string | null;
  isPreview: boolean;
  lessonStatus: string;
}

export type LessonAccessResolution = LessonAccessLevel | "NOT_FOUND";

/**
 * Single decision point for learner-facing lesson reads:
 * - draft lessons read as NOT_FOUND for everyone (owner previews live in the
 *   owner console, so the learner API never exposes them);
 * - ACTIVE/COMPLETED enrolments see everything;
 * - preview-marked lessons are public;
 * - everything else is a paywall NONE (callers still receive the DTO so the
 *   client can render the enrol CTA).
 */
export function describeLessonAccess(input: LessonAccessInput): LessonAccessResolution {
  if (input.lessonStatus !== "PUBLISHED") return "NOT_FOUND";
  if (input.enrolmentStatus === "ACTIVE" || input.enrolmentStatus === "COMPLETED") {
    return "ENROLLED";
  }
  if (input.isPreview) return "PREVIEW";
  return "NONE";
}

// ---------------------------------------------------------------------------
// Curriculum ordering and next-lesson choice
// ---------------------------------------------------------------------------

/** Sort key matching the curriculum order: section position, then lesson position. */
export interface CurriculumOrderKey {
  sectionPosition: number;
  position: number;
}

/** Comparator for flat lesson lists that lost their section nesting. */
export function compareCurriculumOrder(a: CurriculumOrderKey, b: CurriculumOrderKey): number {
  if (a.sectionPosition !== b.sectionPosition) return a.sectionPosition - b.sectionPosition;
  return a.position - b.position;
}

/**
 * First lesson of an ordered curriculum that the learner has not completed,
 * or null when everything is done. Expects `lessons` already in curriculum
 * order (see compareCurriculumOrder).
 */
export function pickNextLesson<T extends { id: string }>(
  lessons: readonly T[],
  completedIds: ReadonlySet<string>,
): T | null {
  return lessons.find((lesson) => !completedIds.has(lesson.id)) ?? null;
}

// ---------------------------------------------------------------------------
// Continue-learning rail
// ---------------------------------------------------------------------------

export interface ContinueLearningCandidate {
  courseId: string;
  /** ISO timestamp of the learner's latest activity, or null when untapped. */
  lastActivityAt: string | null;
  /** ISO enrolment timestamp; orders untouched courses. */
  enrolledAt: string;
}

/**
 * Which enrolments earn a "continue learning" card, most relevant first:
 * courses with progress lead (latest activity first), untouched courses fill
 * the remaining slots (most recent enrolment first).
 */
export function pickContinueLearningCourses(
  candidates: readonly ContinueLearningCandidate[],
  limit: number,
): string[] {
  const ordered = [...candidates].sort((a, b) => {
    if (a.lastActivityAt !== null && b.lastActivityAt === null) return -1;
    if (a.lastActivityAt === null && b.lastActivityAt !== null) return 1;
    const aKey = a.lastActivityAt ?? a.enrolledAt;
    const bKey = b.lastActivityAt ?? b.enrolledAt;
    // ISO timestamps compare lexicographically in chronological order.
    if (aKey !== bKey) return aKey < bKey ? 1 : -1;
    if (a.enrolledAt !== b.enrolledAt) return a.enrolledAt < b.enrolledAt ? 1 : -1;
    return 0;
  });
  return ordered.slice(0, limit).map((candidate) => candidate.courseId);
}

// ---------------------------------------------------------------------------
// Notes export rendering
// ---------------------------------------------------------------------------

export interface NoteExportEntry {
  courseTitle: string;
  lessonTitle: string;
  /** Preformatted date shown next to the lesson title. */
  date: string;
  body: string;
}

/**
 * Markdown rendering of the learner's notes export: one `# course` heading
 * per course (entries must arrive grouped by course), then `## lesson — date`
 * blocks with the note body.
 */
export function buildNotesExportMarkdown(entries: readonly NoteExportEntry[]): string {
  if (entries.length === 0) return "# My notes\n\nNo saved notes yet.\n";

  const blocks: string[] = [];
  let currentCourse: string | null = null;
  for (const entry of entries) {
    if (entry.courseTitle !== currentCourse) {
      blocks.push(`# ${entry.courseTitle}`);
      currentCourse = entry.courseTitle;
    }
    blocks.push(`## ${entry.lessonTitle} — ${entry.date}\n\n${entry.body}`);
  }
  return `${blocks.join("\n\n")}\n`;
}
