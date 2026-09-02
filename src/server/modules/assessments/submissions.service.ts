import { z } from "zod";
import { EnrolmentStatus, LessonStatus, Prisma, SubmissionStatus } from "@prisma/client";
import {
  ASSIGNMENT_DEADLINE_PASSED,
  ASSIGNMENT_NOT_CONFIGURED,
  ASSIGNMENT_RESUBMISSION_NOT_ALLOWED,
  GRADE_SCORE_OUT_OF_RANGE,
  SUBMISSION_NOT_FOUND,
  SUBMISSION_NOT_RETURNABLE,
  gradingQueueQuerySchema,
  type AssignmentLearnerViewDto,
  type GradeCreateInput,
  type GradingDetailDto,
  type LearnerSubmissionDto,
  type PaginatedGradingQueueDto,
  type SubmissionCreateInput,
  type SubmissionReturnInput,
} from "@/contracts/assessments";
import { COURSE_NOT_ENROLLED, LESSON_NOT_FOUND } from "@/contracts/learning";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import { computeProgressPercent } from "@/server/modules/learning/learning.logic";
import { evaluateSubmissionEligibility, isGradeScoreInRange } from "@/server/modules/assessments/assessments.logic";

// Authorization model: learner reads/writes resolve through
// requireAuthenticatedUser(headers) and are pinned to that user id; the
// grading functions trust the owner guard (requireOwner) applied by their
// /api/v1/owner routes. Submission eligibility always goes through
// evaluateSubmissionEligibility so the learner view's `canSubmit` hint and
// the create endpoint can never disagree.

function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Loads a published lesson or fails with the shared learner-facing 404. */
async function loadPublishedLesson(lessonId: string) {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, title: true, courseId: true, status: true },
  });
  if (!lesson || lesson.status !== LessonStatus.PUBLISHED) {
    throw new ApiError(404, LESSON_NOT_FOUND, "The lesson was not found.");
  }
  return lesson;
}

/** Assessments live inside the classroom: preview lessons do not open them. */
async function assertEnrolled(userId: string, courseId: string): Promise<void> {
  const enrolment = await db.enrolment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { status: true },
  });
  const enrolled =
    enrolment?.status === EnrolmentStatus.ACTIVE || enrolment?.status === EnrolmentStatus.COMPLETED;
  if (!enrolled) {
    throw new ApiError(422, COURSE_NOT_ENROLLED, "Enroll in the course to open this assignment.");
  }
}

function toLearnerSubmissionDto(row: {
  id: string;
  attemptNumber: number;
  status: SubmissionStatus;
  body: string;
  attachmentUrl: string | null;
  submittedAt: Date;
  returnedFeedback: string | null;
  returnedAt: Date | null;
  grades: { score: number; maxPoints: number; feedback: string | null; createdAt: Date }[];
}): LearnerSubmissionDto {
  // The learner sees the latest grade row only (full history stays owner-side).
  const latestGrade = row.grades[0];
  return {
    id: row.id,
    attemptNumber: row.attemptNumber,
    status: row.status,
    body: row.body,
    attachmentUrl: row.attachmentUrl,
    submittedAt: row.submittedAt.toISOString(),
    latestGrade: latestGrade
      ? {
          score: latestGrade.score,
          maxPoints: latestGrade.maxPoints,
          feedback: latestGrade.feedback,
          gradedAt: latestGrade.createdAt.toISOString(),
        }
      : null,
    returnedFeedback: row.returnedFeedback,
    returnedAt: row.returnedAt?.toISOString() ?? null,
  };
}

const LEARNER_SUBMISSION_SELECT = {
  id: true,
  attemptNumber: true,
  status: true,
  body: true,
  attachmentUrl: true,
  returnedFeedback: true,
  returnedAt: true,
  submittedAt: true,
  grades: { orderBy: { createdAt: "desc" as const }, take: 1, select: { score: true, maxPoints: true, feedback: true, createdAt: true } },
} satisfies Prisma.AssignmentSubmissionSelect;

// ---------------------------------------------------------------------------
// Learner assignment view
// ---------------------------------------------------------------------------

/**
 * Assignment brief plus the caller's submissions (ascending) and a canSubmit
 * hint derived from the same policy the create endpoint enforces.
 *
 * Query budget: 4 (lesson, enrolment, assignment, the caller's submissions
 * with their latest grade each).
 */
export async function getAssignmentLearnerView(
  userId: string,
  lessonId: string,
): Promise<AssignmentLearnerViewDto> {
  const lesson = await loadPublishedLesson(lessonId);
  await assertEnrolled(userId, lesson.courseId);

  const assignment = await db.assignment.findUnique({ where: { lessonId } });
  if (!assignment) {
    throw new ApiError(
      404,
      ASSIGNMENT_NOT_CONFIGURED,
      "No assignment has been configured for this lesson.",
    );
  }

  const submissions = await db.assignmentSubmission.findMany({
    where: { assignmentId: assignment.id, userId },
    orderBy: { attemptNumber: "asc" },
    select: LEARNER_SUBMISSION_SELECT,
  });

  const now = new Date();
  const latest = submissions.at(-1);
  const eligibility = evaluateSubmissionEligibility({
    now: now.toISOString(),
    dueAt: assignment.dueAt?.toISOString() ?? null,
    submissionsUsed: submissions.length,
    allowResubmission: assignment.allowResubmission,
    // One open (SUBMITTED, ungraded) submission at a time; RETURNED means the
    // ball is back with the learner.
    hasOpenSubmission: latest?.status === SubmissionStatus.SUBMITTED,
  });

  return {
    lesson: { id: lesson.id, title: lesson.title },
    assignment: {
      id: assignment.id,
      instructions: assignment.instructions,
      maxPoints: assignment.maxPoints,
      dueAt: assignment.dueAt?.toISOString() ?? null,
      allowResubmission: assignment.allowResubmission,
    },
    myState: {
      submissionsUsed: submissions.length,
      canSubmit: eligibility.canSubmit,
      submissions: submissions.map(toLearnerSubmissionDto),
    },
  };
}

// ---------------------------------------------------------------------------
// Submission create
// ---------------------------------------------------------------------------

/**
 * Records the learner's submission. Deadline and resubmission policy come
 * from the shared eligibility decision; only one ungraded submission may be
 * open at a time.
 *
 * Concurrency: attemptNumber = submissionsUsed + 1 can race between two
 * simultaneous posts; the (assignmentId, userId, attemptNumber) unique
 * arbitrates and the loser retries once with a fresh count (a second failure
 * surfaces as 409 via the infrastructure error mapper).
 *
 * Query budget: 5 reads (lesson, enrolment, assignment, count, latest) +
 * tx { create + audit } and at most one retry.
 */
export async function createSubmission(
  userId: string,
  lessonId: string,
  input: SubmissionCreateInput,
  requestId: string,
): Promise<{ submission: LearnerSubmissionDto }> {
  const lesson = await loadPublishedLesson(lessonId);
  await assertEnrolled(userId, lesson.courseId);

  const assignment = await db.assignment.findUnique({
    where: { lessonId },
    select: { id: true, dueAt: true, allowResubmission: true },
  });
  if (!assignment) {
    throw new ApiError(
      404,
      ASSIGNMENT_NOT_CONFIGURED,
      "No assignment has been configured for this lesson.",
    );
  }

  const now = new Date();
  const [submissionsUsed, latest] = await Promise.all([
    db.assignmentSubmission.count({ where: { assignmentId: assignment.id, userId } }),
    db.assignmentSubmission.findFirst({
      where: { assignmentId: assignment.id, userId },
      orderBy: { attemptNumber: "desc" },
      select: { status: true },
    }),
  ]);

  const eligibility = evaluateSubmissionEligibility({
    now: now.toISOString(),
    dueAt: assignment.dueAt?.toISOString() ?? null,
    submissionsUsed,
    allowResubmission: assignment.allowResubmission,
    hasOpenSubmission: latest?.status === SubmissionStatus.SUBMITTED,
  });
  if (!eligibility.canSubmit) {
    throw eligibility.blocker === "DEADLINE_PASSED"
      ? new ApiError(422, ASSIGNMENT_DEADLINE_PASSED, "The assignment deadline has passed.")
      : new ApiError(
          422,
          ASSIGNMENT_RESUBMISSION_NOT_ALLOWED,
          "A new submission is not allowed right now.",
        );
  }

  const createSubmissionTx = (attemptNumber: number) =>
    withTransaction(async (tx) => {
      const created = await tx.assignmentSubmission.create({
        data: {
          assignmentId: assignment.id,
          courseId: lesson.courseId,
          userId,
          attemptNumber,
          body: input.body,
          attachmentUrl: input.attachmentUrl,
        },
        select: LEARNER_SUBMISSION_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "assignment.submitted",
          entityType: "AssignmentSubmission",
          entityId: created.id,
          requestId,
          metadata: { assignmentId: assignment.id, courseId: lesson.courseId, attemptNumber },
        },
        select: { id: true },
      });
      return created;
    });

  let submission;
  try {
    submission = await createSubmissionTx(submissionsUsed + 1);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lost the attemptNumber race: recompute and retry once.
    const recount = await db.assignmentSubmission.count({
      where: { assignmentId: assignment.id, userId },
    });
    submission = await createSubmissionTx(recount + 1);
  }

  // A brand-new submission has no grade history yet.
  return { submission: toLearnerSubmissionDto(submission) };
}

// ---------------------------------------------------------------------------
// Owner grading queue
// ---------------------------------------------------------------------------

/**
 * Keyset cursor for the queue's (submittedAt desc, id desc) sort. Mirrors the
 * ActivityCursor pattern in src/server/http/pagination.ts; kept local so each
 * list's sort key stays explicit in the encoded payload (same rationale the
 * pagination module gives for not overloading the createdAt cursor).
 */
const submissionCursorSchema = z.object({
  submittedAt: z.iso.datetime(),
  id: z.uuid(),
});

type SubmissionCursor = z.infer<typeof submissionCursorSchema>;

function encodeSubmissionCursor(cursor: SubmissionCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSubmissionCursor(value: string): SubmissionCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return submissionCursorSchema.parse(decoded);
  } catch {
    throw new ApiError(422, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }
}

const GRADING_QUEUE_SELECT = {
  id: true,
  assignmentId: true,
  attemptNumber: true,
  status: true,
  submittedAt: true,
  user: { select: { id: true, name: true, email: true } },
  assignment: {
    select: {
      maxPoints: true,
      lesson: { select: { title: true } },
      course: { select: { title: true, slug: true } },
    },
  },
  grades: { orderBy: { createdAt: "desc" as const }, take: 1, select: { score: true } },
} satisfies Prisma.AssignmentSubmissionSelect;

/**
 * Owner grading queue, newest submissions first, filterable by course and
 * status. One bounded findMany with nested selects (latest grade row per
 * submission) plus one count for the total.
 *
 * Query budget: 2 (page + total) regardless of depth.
 */
export async function listGradingQueue(
  input: unknown,
): Promise<PaginatedGradingQueueDto> {
  const query = gradingQueueQuerySchema.parse(input);

  const where: Prisma.AssignmentSubmissionWhereInput = {
    ...(query.courseId ? { courseId: query.courseId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  if (query.cursor) {
    const cursor = decodeSubmissionCursor(query.cursor);
    const cursorDate = new Date(cursor.submittedAt);
    where.AND = [
      {
        OR: [
          { submittedAt: { lt: cursorDate } },
          { submittedAt: cursorDate, id: { lt: cursor.id } },
        ],
      },
    ];
  }

  const [rows, total] = await Promise.all([
    db.assignmentSubmission.findMany({
      where,
      select: GRADING_QUEUE_SELECT,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    }),
    db.assignmentSubmission.count({ where }),
  ]);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const lastItem = items.at(-1);

  return {
    items: items.map((row) => ({
      id: row.id,
      assignmentId: row.assignmentId,
      lessonTitle: row.assignment.lesson.title,
      courseTitle: row.assignment.course.title,
      courseSlug: row.assignment.course.slug,
      student: row.user,
      attemptNumber: row.attemptNumber,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      latestScore: row.grades[0]?.score ?? null,
      maxPoints: row.assignment.maxPoints,
    })),
    nextCursor:
      hasMore && lastItem
        ? encodeSubmissionCursor({
            submittedAt: lastItem.submittedAt.toISOString(),
            id: lastItem.id,
          })
        : null,
    total,
  };
}

// ---------------------------------------------------------------------------
// Owner grading detail
// ---------------------------------------------------------------------------

/**
 * One submission with its brief context and the full (ascending) grade
 * history. Single query — everything hangs off the submission row.
 *
 * Query budget: 1.
 */
export async function getGradingDetail(submissionId: string): Promise<GradingDetailDto> {
  const row = await db.assignmentSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      attemptNumber: true,
      status: true,
      body: true,
      attachmentUrl: true,
      submittedAt: true,
      returnedFeedback: true,
      returnedAt: true,
      user: { select: { id: true, name: true, email: true } },
      assignment: {
        select: {
          id: true,
          instructions: true,
          maxPoints: true,
          dueAt: true,
          allowResubmission: true,
          lesson: { select: { title: true } },
          course: { select: { title: true } },
        },
      },
      grades: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          score: true,
          maxPoints: true,
          feedback: true,
          createdAt: true,
          gradedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!row) throw new ApiError(404, SUBMISSION_NOT_FOUND, "The submission was not found.");

  return {
    submission: {
      id: row.id,
      attemptNumber: row.attemptNumber,
      status: row.status,
      body: row.body,
      attachmentUrl: row.attachmentUrl,
      submittedAt: row.submittedAt.toISOString(),
      returnedFeedback: row.returnedFeedback,
      returnedAt: row.returnedAt?.toISOString() ?? null,
      student: row.user,
    },
    assignment: {
      id: row.assignment.id,
      instructions: row.assignment.instructions,
      maxPoints: row.assignment.maxPoints,
      dueAt: row.assignment.dueAt?.toISOString() ?? null,
      allowResubmission: row.assignment.allowResubmission,
      lessonTitle: row.assignment.lesson.title,
      courseTitle: row.assignment.course.title,
    },
    grades: row.grades.map((grade) => ({
      id: grade.id,
      score: grade.score,
      maxPoints: grade.maxPoints,
      feedback: grade.feedback,
      gradedBy: grade.gradedBy,
      gradedAt: grade.createdAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Owner grading
// ---------------------------------------------------------------------------

/**
 * Records a grade. History is append-only: re-grading appends another row and
 * flips the submission back to GRADED — never a 409. maxPoints is snapshotted
 * onto the grade row so later brief edits cannot reinterpret the score. An
 * outbox event fans out per grade (Phase 10 notifications; certificate
 * eligibility reads the submissions/grades directly).
 *
 * Query budget: 1 read (submission + assignment) + tx { create grade, flip
 * status, audit, outbox }.
 */
export async function gradeSubmission(
  ownerId: string,
  submissionId: string,
  input: GradeCreateInput,
  requestId: string,
): Promise<{
  submission: { id: string; status: SubmissionStatus };
  grade: { id: string; score: number; maxPoints: number; feedback: string | null; gradedAt: string };
}> {
  const submission = await db.assignmentSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      assignmentId: true,
      courseId: true,
      userId: true,
      assignment: { select: { maxPoints: true } },
    },
  });
  if (!submission) {
    throw new ApiError(404, SUBMISSION_NOT_FOUND, "The submission was not found.");
  }
  if (!isGradeScoreInRange(input.score, submission.assignment.maxPoints)) {
    throw new ApiError(
      422,
      GRADE_SCORE_OUT_OF_RANGE,
      `The score must be between 0 and ${submission.assignment.maxPoints}.`,
    );
  }

  return withTransaction(async (tx) => {
    const grade = await tx.assignmentGrade.create({
      data: {
        submissionId: submission.id,
        score: input.score,
        maxPoints: submission.assignment.maxPoints,
        feedback: input.feedback,
        gradedByUserId: ownerId,
      },
      select: { id: true, createdAt: true },
    });

    await tx.assignmentSubmission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.GRADED },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: ownerId,
        action: "grading.recorded",
        entityType: "AssignmentGrade",
        entityId: grade.id,
        requestId,
        metadata: {
          submissionId: submission.id,
          assignmentId: submission.assignmentId,
          score: input.score,
          maxPoints: submission.assignment.maxPoints,
        },
      },
      select: { id: true },
    });

    // Consumers: Phase 10 notifications. The grade id in the eventKey makes
    // each appended grade exactly-once (re-grading legitimately re-fires).
    await tx.outboxEvent.create({
      data: {
        eventKey: `assignment.graded:${grade.id}`,
        topic: "assignment.graded",
        aggregateType: "AssignmentGrade",
        aggregateId: grade.id,
        payload: {
          submissionId: submission.id,
          assignmentId: submission.assignmentId,
          courseId: submission.courseId,
          studentUserId: submission.userId,
          score: input.score,
          maxPoints: submission.assignment.maxPoints,
          scorePercent: computeProgressPercent(input.score, submission.assignment.maxPoints),
        },
      },
      select: { id: true },
    });

    return {
      submission: { id: submission.id, status: SubmissionStatus.GRADED },
      grade: {
        id: grade.id,
        score: input.score,
        maxPoints: submission.assignment.maxPoints,
        feedback: input.feedback,
        gradedAt: grade.createdAt.toISOString(),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Owner "return for revision"
// ---------------------------------------------------------------------------

/**
 * Sends a submission back to the learner with feedback. Allowed from
 * SUBMITTED (not yet graded) or GRADED (grade given, but the owner wants a
 * revision); a RETURNED row cannot be returned again — the learner answers
 * with a fresh attempt row instead. The learner can resubmit per the shared
 * eligibility policy (RETURNED frees the "one open submission" slot).
 *
 * An `assignment.returned` outbox event fans out the in-app notification and
 * the revision-request email (Phase 10 dispatcher).
 *
 * Query budget: 1 read + tx { guarded updateMany, audit, outbox }.
 */
export async function returnSubmission(
  ownerId: string,
  submissionId: string,
  input: SubmissionReturnInput,
  requestId: string,
): Promise<{
  submission: {
    id: string;
    status: SubmissionStatus;
    returnedFeedback: string;
    returnedAt: string;
  };
}> {
  const submission = await db.assignmentSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, status: true, userId: true, assignmentId: true, courseId: true },
  });
  if (!submission) {
    throw new ApiError(404, SUBMISSION_NOT_FOUND, "The submission was not found.");
  }
  if (submission.status === SubmissionStatus.RETURNED) {
    throw new ApiError(
      422,
      SUBMISSION_NOT_RETURNABLE,
      "This submission has already been returned for revision.",
    );
  }

  const returnedAt = new Date();
  await withTransaction(async (tx) => {
    // The guarded updateMany is the concurrency gate: only a transition from
    // SUBMITTED/GRADED wins, so a racing grade and return cannot both apply.
    const flipped = await tx.assignmentSubmission.updateMany({
      where: { id: submission.id, status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.GRADED] } },
      data: {
        status: SubmissionStatus.RETURNED,
        returnedFeedback: input.feedback,
        returnedAt,
      },
    });
    if (flipped.count !== 1) {
      throw new ApiError(
        422,
        SUBMISSION_NOT_RETURNABLE,
        "This submission has already been returned for revision.",
      );
    }

    await tx.auditLog.create({
      data: {
        actorUserId: ownerId,
        action: "grading.returned",
        entityType: "AssignmentSubmission",
        entityId: submission.id,
        requestId,
        metadata: {
          assignmentId: submission.assignmentId,
          courseId: submission.courseId,
          studentUserId: submission.userId,
        },
      },
      select: { id: true },
    });

    await tx.outboxEvent.create({
      data: {
        // A submission row can be returned more than once across its life
        // (GRADED -> RETURNED -> re-graded -> RETURNED), so the eventKey
        // carries the timestamp of THIS transition; the guarded updateMany
        // above is what makes the side effect exactly-once.
        eventKey: `assignment.returned:${submission.id}:${returnedAt.toISOString()}`,
        topic: "assignment.returned",
        aggregateType: "AssignmentSubmission",
        aggregateId: submission.id,
        payload: {
          submissionId: submission.id,
          assignmentId: submission.assignmentId,
          courseId: submission.courseId,
          studentUserId: submission.userId,
          feedback: input.feedback,
        },
      },
      select: { id: true },
    });
  });

  return {
    submission: {
      id: submission.id,
      status: SubmissionStatus.RETURNED,
      returnedFeedback: input.feedback,
      returnedAt: returnedAt.toISOString(),
    },
  };
}
