import { EnrolmentStatus, LessonStatus } from "@prisma/client";
import type { LessonNoteDto } from "@/contracts/learning";
import { COURSE_NOT_ENROLLED, LESSON_NOT_FOUND } from "@/contracts/learning";
import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";
import { buildNotesExportMarkdown, type NoteExportEntry } from "@/server/modules/learning/learning.logic";

// Authorization model: notes are private per learner. Every query is keyed by
// the authenticated user id, so a caller can only ever read/write their own
// note for a lesson; the write path additionally requires course access.

/** Download name of GET /api/v1/learning/notes/export. */
const NOTES_EXPORT_FILENAME = "dtg-notes.md";
/** Length of the YYYY-MM-DD prefix of an ISO timestamp. */
const EXPORT_DATE_LENGTH = 10;

/**
 * The caller's own note for a lesson, or null when none saved yet. The lesson
 * itself is not validated here: a note can only exist for a lesson the
 * learner had access to when saving.
 */
export async function getMyNote(
  userId: string,
  lessonId: string,
): Promise<{ note: LessonNoteDto | null }> {
  const note = await db.lessonNote.findUnique({
    where: { userId_lessonId: { userId, lessonId } },
  });
  return { note: note ? toNoteDto(note) : null };
}

/**
 * Upsert of the caller's one note per lesson. Requires a published lesson and
 * an ACTIVE/COMPLETED enrolment so note-taking stays inside the classroom.
 */
export async function saveMyNote(
  userId: string,
  lessonId: string,
  input: { body: string },
): Promise<{ note: LessonNoteDto }> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, courseId: true, status: true },
  });
  if (!lesson || lesson.status !== LessonStatus.PUBLISHED) {
    throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");
  }

  const enrolment = await db.enrolment.findUnique({
    where: { userId_courseId: { userId, courseId: lesson.courseId } },
    select: { status: true },
  });
  if (!enrolment || (enrolment.status !== EnrolmentStatus.ACTIVE && enrolment.status !== EnrolmentStatus.COMPLETED)) {
    throw new ApiError(422, COURSE_NOT_ENROLLED, "Enroll in the course to save notes.");
  }

  // Plain upsert on the (userId, lessonId) unique key — Prisma lowers this to
  // a single INSERT ... ON CONFLICT, so concurrent saves cannot 409.
  const note = await db.lessonNote.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    create: { userId, lessonId, courseId: lesson.courseId, body: input.body },
    update: { body: input.body },
  });
  return { note: toNoteDto(note) };
}

/**
 * Idempotent delete: deleteMany (keyed to the caller) succeeds whether or not
 * a note exists, so repeated DELETEs never 404.
 */
export async function deleteMyNote(
  userId: string,
  lessonId: string,
): Promise<{ note: null }> {
  await db.lessonNote.deleteMany({ where: { userId, lessonId } });
  return { note: null };
}

/**
 * Markdown export of every note the learner ever wrote, ordered by course
 * then section/lesson position. One query bounded by the learner's own note
 * count; the cross-relation ordering happens in JS because Prisma cannot
 * order by fields of two different relations at once.
 */
export async function exportMyNotes(
  userId: string,
): Promise<{ filename: string; markdown: string }> {
  const notes = await db.lessonNote.findMany({
    where: { userId },
    select: {
      body: true,
      updatedAt: true,
      lesson: {
        select: { title: true, position: true, section: { select: { position: true } } },
      },
      course: { select: { title: true } },
    },
  });

  notes.sort((a, b) => {
    if (a.course.title !== b.course.title) return a.course.title.localeCompare(b.course.title);
    if (a.lesson.section.position !== b.lesson.section.position) {
      return a.lesson.section.position - b.lesson.section.position;
    }
    return a.lesson.position - b.lesson.position;
  });

  const entries: NoteExportEntry[] = notes.map((note) => ({
    courseTitle: note.course.title,
    lessonTitle: note.lesson.title,
    date: note.updatedAt.toISOString().slice(0, EXPORT_DATE_LENGTH),
    body: note.body,
  }));

  return { filename: NOTES_EXPORT_FILENAME, markdown: buildNotesExportMarkdown(entries) };
}

function toNoteDto(note: {
  lessonId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}): LessonNoteDto {
  return {
    lessonId: note.lessonId,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}
