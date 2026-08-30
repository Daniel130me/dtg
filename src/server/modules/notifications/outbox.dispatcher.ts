import { DiscussionStatus, OutboxStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_LINK_MAX,
  NOTIFICATION_TITLE_MAX,
} from "@/contracts/notifications";
import { db } from "@/server/db/client";
import {
  absoluteEmailUrl,
  buildAssignmentGradedEmail,
  buildCertificateIssuedEmail,
  buildDiscussionReplyEmail,
  buildEnrolmentConfirmedEmail,
  buildReviewReplyEmail,
  renderExcerpt,
} from "@/server/email/email.logic";
import { EmailDeliveryError, sendWithSuppressionCheck } from "@/server/email/email-port";
import { recordJobFailure, recordOutboxEvent } from "@/server/observability/metrics";
import { logger } from "@/server/observability/logger";
import { withSpan } from "@/server/observability/trace";
import { purgeExpiredContactBodies } from "@/server/modules/support/contact.service";

// ---------------------------------------------------------------------------
// Phase 10 outbox dispatcher.
//
// Delivery model: domain writes emit OutboxEvents inside their transactions;
// this dispatcher projects each event into (a) in-app Notification rows — the
// durable, deduplicated part — and (b) one transactional email — best-effort.
//
// Exactly-once vs at-most-once: notification rows carry
// dedupeKey = "<eventKey>:<recipientUserId>" with a UNIQUE constraint and are
// inserted with skipDuplicates, so a replayed/retried event cannot create a
// second row (at-most-once projection). Emails have no such ledger; they are
// attempted once per processing pass and are NOT re-sent on replays because a
// completed event is never reprocessed — the acceptable residual risk is a
// lost email, never a duplicate send storm.
//
// Concurrency: the claim is a simple guarded updateMany (status PENDING ->
// PROCESSING). This is a non-locking, single-process claim by design; if the
// process dies mid-event the row stays PROCESSING and needs a manual reset,
// which is the documented trade-off for this deployment stage.
//
// Retry policy: retryable errors go back to PENDING with exponential backoff
// (outboxBackoffMs). Permanent email errors (EmailDeliveryError with
// permanent=true) and exhausted attempts (MAX_OUTBOX_ATTEMPTS) FAIL the event
// so a poison event cannot spin forever. Per-event failures are aggregated
// into the DispatchResult — dispatchPendingOutbox only throws on db-down so
// the caller decides what to do with a broken database.
// ---------------------------------------------------------------------------

export const OUTBOX_TOPICS = {
  enrolmentConfirmed: "enrolment.confirmed",
  assignmentGraded: "assignment.graded",
  certificateIssued: "certificate.issued",
  certificateRevoked: "certificate.revoked",
  courseCompleted: "course.completed",
  discussionThreadCreated: "discussion.thread_created",
  discussionThreadReplied: "discussion.thread_replied",
  reviewOwnerReplied: "review.owner_replied",
  reviewCreated: "review.created",
  reviewUpdated: "review.updated",
} as const;

export const MAX_OUTBOX_ATTEMPTS = 5;
const DEFAULT_DISPATCH_LIMIT = 20;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;

export interface DispatchResult {
  processed: number;
  completed: number;
  failed: number;
  suppressedEmails: number;
  notificationsCreated: number;
  emailsSent: number;
}

/** Exponential backoff capped at 15 minutes; attempts is the 1-based count. */
export function outboxBackoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

// ---------------------------------------------------------------------------
// Planning (pure) — unit-tested without a database.
// ---------------------------------------------------------------------------

/**
 * Per-topic context the dispatcher resolved from the database BEFORE planning
 * (recipient email, thread author, slugs, absolute URLs). The planner itself
 * stays pure: given the same payload + resolution it always returns the same
 * plan, so the notification matrix is unit-testable.
 */
export interface OutboxResolution {
  recipientEmail?: string;
  learnerName?: string;
  courseTitle?: string;
  courseSlug?: string;
  lessonId?: string;
  lessonTitle?: string;
  threadTitle?: string;
  replyExcerpt?: string;
  gradeFeedback?: string;
  threadAuthorUserId?: string;
  threadStatus?: string;
  ownerUserId?: string;
  threadUrl?: string;
  courseUrl?: string;
  verifyUrl?: string;
}

export interface OutboxNotificationPlan {
  userId: string;
  topic: string;
  title: string;
  body?: string;
  linkPath?: string;
  dedupeKeySuffix: string;
}

export type OutboxEmailPlan =
  | { to: string; template: "enrolmentConfirmed"; params: Parameters<typeof buildEnrolmentConfirmedEmail>[0] }
  | { to: string; template: "assignmentGraded"; params: Parameters<typeof buildAssignmentGradedEmail>[0] }
  | { to: string; template: "certificateIssued"; params: Parameters<typeof buildCertificateIssuedEmail>[0] }
  | { to: string; template: "discussionReply"; params: Parameters<typeof buildDiscussionReplyEmail>[0] }
  | { to: string; template: "reviewReply"; params: Parameters<typeof buildReviewReplyEmail>[0] };

export interface EventPlan {
  notifications: OutboxNotificationPlan[];
  email?: OutboxEmailPlan;
}

/** Renders the planned email through the shared pure template builders. */
export function renderOutboxEmail(email: OutboxEmailPlan): { subject: string; text: string; html: string } {
  switch (email.template) {
    case "enrolmentConfirmed":
      return buildEnrolmentConfirmedEmail(email.params);
    case "assignmentGraded":
      return buildAssignmentGradedEmail(email.params);
    case "certificateIssued":
      return buildCertificateIssuedEmail(email.params);
    case "discussionReply":
      return buildDiscussionReplyEmail(email.params);
    case "reviewReply":
      return buildReviewReplyEmail(email.params);
  }
}

// Outbox payloads are Json columns (unknown at runtime). Each topic gets an
// explicit schema; a malformed payload throws and is handled by the retry
// policy (a bug should surface as FAILED, not silently vanish).

const enrolmentConfirmedPayloadSchema = z.object({
  enrolmentId: z.string(),
  userId: z.uuid(),
  courseId: z.string(),
  courseTitle: z.string().min(1),
  courseSlug: z.string().min(1),
});

// NOTE: the live emit site (submissions.service.ts) keys the learner as
// `studentUserId` (NOT userId) and carries no feedback/lessonId/courseSlug —
// those are resolved per event by the dispatcher below.
const assignmentGradedPayloadSchema = z.object({
  submissionId: z.string(),
  assignmentId: z.string(),
  courseId: z.string(),
  studentUserId: z.uuid(),
  score: z.number(),
  maxPoints: z.number(),
  scorePercent: z.number().optional(),
});

const certificateIssuedPayloadSchema = z.object({
  certificateId: z.string(),
  userId: z.uuid(),
  courseId: z.string(),
  code: z.string().min(1),
});

// NOTE: the live emit site (progress.service.ts) does NOT include the
// enrolmentId in the payload (it is the eventKey suffix instead) — the plan
// only needs userId, which IS present.
const courseCompletedPayloadSchema = z.object({
  userId: z.uuid(),
  courseId: z.string(),
  completedAt: z.string().optional(),
});

const discussionThreadRepliedPayloadSchema = z.object({
  threadId: z.string(),
  courseId: z.string(),
  lessonId: z.string(),
  authorUserId: z.uuid(),
});

const discussionThreadCreatedPayloadSchema = z.object({
  courseId: z.string(),
  lessonId: z.string(),
  threadId: z.string(),
  authorUserId: z.uuid(),
});

const reviewOwnerRepliedPayloadSchema = z.object({
  reviewId: z.string(),
  courseId: z.string(),
  authorUserId: z.uuid(),
  reviewExcerpt: z.string().optional(),
  replyExcerpt: z.string().min(1),
});

/** Pure topic -> plan matrix. null = nothing to do (completed immediately). */
export function planOutboxEvent(topic: string, payload: unknown, resolution: OutboxResolution = {}): EventPlan | null {
  switch (topic) {
    case OUTBOX_TOPICS.enrolmentConfirmed: {
      const data = enrolmentConfirmedPayloadSchema.parse(payload);
      return {
        notifications: [
          {
            userId: data.userId,
            topic,
            title: `You're enrolled in ${data.courseTitle}`,
            body: "Start learning now — your classroom is ready.",
            linkPath: `/learning/${data.courseSlug}`,
            dedupeKeySuffix: data.userId,
          },
        ],
        // Best-effort: without a resolvable recipient email the in-app
        // notification still stands (email is never the durable part).
        email: resolution.recipientEmail
          ? {
              to: resolution.recipientEmail,
              template: "enrolmentConfirmed",
              params: {
                courseTitle: data.courseTitle,
                courseSlug: data.courseSlug,
                learnerName: resolution.learnerName,
              },
            }
          : undefined,
      };
    }

    case OUTBOX_TOPICS.assignmentGraded: {
      const data = assignmentGradedPayloadSchema.parse(payload);
      // lessonId/courseSlug may be missing from the payload; the dispatcher
      // resolves them from submission -> assignment -> lesson when present.
      const linkPath = resolution.courseSlug
        ? resolution.lessonId
          ? `/learning/${resolution.courseSlug}/${resolution.lessonId}`
          : `/learning/${resolution.courseSlug}`
        : undefined;
      return {
        notifications: [
          {
            userId: data.studentUserId,
            topic,
            title: `Assignment graded: ${data.score}/${data.maxPoints}`,
            linkPath,
            dedupeKeySuffix: data.studentUserId,
          },
        ],
        email: resolution.recipientEmail
          ? {
              to: resolution.recipientEmail,
              template: "assignmentGraded",
              params: {
                courseTitle: resolution.courseTitle ?? "your course",
                lessonTitle: resolution.lessonTitle ?? "your assignment",
                score: data.score,
                maxPoints: data.maxPoints,
                feedback: resolution.gradeFeedback,
              },
            }
          : undefined,
      };
    }

    case OUTBOX_TOPICS.certificateIssued: {
      const data = certificateIssuedPayloadSchema.parse(payload);
      return {
        notifications: [
          {
            userId: data.userId,
            topic,
            title: "Your certificate is ready",
            body: `Your certificate for ${resolution.courseTitle ?? "your course"} is ready to view.`,
            linkPath: "/certificates",
            dedupeKeySuffix: data.userId,
          },
        ],
        email: resolution.recipientEmail
          ? {
              to: resolution.recipientEmail,
              template: "certificateIssued",
              params: {
                courseTitle: resolution.courseTitle ?? "your course",
                verifyUrl: resolution.verifyUrl ?? absoluteEmailUrl(`/certificates/${data.code}`),
                certificateCode: data.code,
              },
            }
          : undefined,
      };
    }

    case OUTBOX_TOPICS.discussionThreadReplied: {
      const data = discussionThreadRepliedPayloadSchema.parse(payload);
      // Notify the THREAD AUTHOR, never the replier — a self-reply is a no-op.
      const authorId = resolution.threadAuthorUserId;
      if (!authorId || authorId === data.authorUserId) return null;
      // Moderation: hidden threads never notify (the reply is invisible).
      if (resolution.threadStatus && resolution.threadStatus !== DiscussionStatus.ACTIVE) return null;
      const linkPath = resolution.courseSlug
        ? `/learning/${resolution.courseSlug}/${data.lessonId}`
        : `/learning/${resolution.courseSlug ?? data.courseId}`;
      return {
        notifications: [
          {
            userId: authorId,
            topic,
            title: resolution.threadTitle
              ? `New reply to your question: ${resolution.threadTitle}`
              : "New reply to your question",
            body: resolution.replyExcerpt ? renderExcerpt(resolution.replyExcerpt) : undefined,
            linkPath,
            dedupeKeySuffix: authorId,
          },
        ],
        email: resolution.recipientEmail
          ? {
              to: resolution.recipientEmail,
              template: "discussionReply",
              params: {
                courseTitle: resolution.courseTitle ?? "your course",
                lessonTitle: resolution.lessonTitle ?? "the lesson",
                threadTitle: resolution.threadTitle ?? "your question",
                replyExcerpt: renderExcerpt(resolution.replyExcerpt ?? ""),
                threadUrl:
                  resolution.threadUrl ??
                  absoluteEmailUrl(`/learning/${resolution.courseSlug ?? data.courseId}/${data.lessonId}`),
              },
            }
          : undefined,
      };
    }

    case OUTBOX_TOPICS.discussionThreadCreated: {
      const data = discussionThreadCreatedPayloadSchema.parse(payload);
      // OWNER digest: in-app only. No email by design — owner question volume
      // would make every new thread an email, and the owner dashboard poll
      // covers it (documented trade-off, revisit if owners ask for mail).
      const ownerId = resolution.ownerUserId;
      if (!ownerId || ownerId === data.authorUserId) return null;
      const linkPath = resolution.courseSlug
        ? `/learning/${resolution.courseSlug}/${data.lessonId}`
        : `/learning/${data.courseId}`;
      return {
        notifications: [
          {
            userId: ownerId,
            topic,
            title: `New question in ${resolution.courseTitle ?? "a course"}`,
            body: resolution.threadTitle ? renderExcerpt(resolution.threadTitle) : undefined,
            linkPath,
            dedupeKeySuffix: ownerId,
          },
        ],
      };
    }

    case OUTBOX_TOPICS.courseCompleted: {
      const data = courseCompletedPayloadSchema.parse(payload);
      // No email: the certificate.issued email covers the celebration moment.
      return {
        notifications: [
          {
            userId: data.userId,
            topic,
            title: "Course completed — claim your certificate!",
            body: "You finished every published lesson. Claim your certificate now.",
            linkPath: "/certificates",
            dedupeKeySuffix: data.userId,
          },
        ],
      };
    }

    case OUTBOX_TOPICS.reviewOwnerReplied: {
      const data = reviewOwnerRepliedPayloadSchema.parse(payload);
      return {
        notifications: [
          {
            userId: data.authorUserId,
            topic,
            title: "The instructor replied to your review",
            body: renderExcerpt(data.replyExcerpt),
            linkPath: resolution.courseSlug ? `/courses/${resolution.courseSlug}` : undefined,
            dedupeKeySuffix: data.authorUserId,
          },
        ],
        email: resolution.recipientEmail
          ? {
              to: resolution.recipientEmail,
              template: "reviewReply",
              params: {
                courseTitle: resolution.courseTitle ?? "your course",
                replyExcerpt: renderExcerpt(data.replyExcerpt),
                courseUrl: resolution.courseUrl ?? absoluteEmailUrl("/"),
              },
            }
          : undefined,
      };
    }

    default:
      // review.created / review.updated (eventKey review.upsert:*),
      // certificate.revoked (no learner email by design) and any future topic
      // all land here: completed immediately, forward-compatible, never FAILED.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Resolution (impure) — the small per-topic db reads the plan needs.
// ---------------------------------------------------------------------------

interface OutboxEventRow {
  id: string;
  eventKey: string | null;
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

async function resolveUserContact(userId: string): Promise<Pick<OutboxResolution, "recipientEmail" | "learnerName">> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  return user ? { recipientEmail: user.email, learnerName: user.name ?? undefined } : {};
}

/**
 * Per-topic db reads. Budgets are documented per case and kept minimal —
 * every query here resolves something the payload genuinely lacks.
 */
async function resolveOutboxContext(event: OutboxEventRow): Promise<OutboxResolution> {
  switch (event.topic) {
    case OUTBOX_TOPICS.enrolmentConfirmed: {
      // 1 query: recipient contact (title/slug ride on the payload).
      const parsed = enrolmentConfirmedPayloadSchema.safeParse(event.payload);
      return parsed.success ? await resolveUserContact(parsed.data.userId) : {};
    }

    case OUTBOX_TOPICS.assignmentGraded: {
      const parsed = assignmentGradedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return {};
      // 4 parallel queries: submission -> assignment -> lesson for the deep
      // link, the grade row for instructor feedback, recipient contact, and
      // the course (Lesson carries only a denormalized courseId, so the
      // course is joined via the payload's own courseId).
      const [submission, grade, contact, course] = await Promise.all([
        db.assignmentSubmission.findUnique({
          where: { id: parsed.data.submissionId },
          select: { assignment: { select: { lesson: { select: { id: true, title: true } } } } },
        }),
        db.assignmentGrade.findUnique({ where: { id: event.aggregateId }, select: { feedback: true } }),
        resolveUserContact(parsed.data.studentUserId),
        db.course.findUnique({ where: { id: parsed.data.courseId }, select: { slug: true, title: true } }),
      ]);
      return {
        courseSlug: course?.slug,
        courseTitle: course?.title,
        lessonId: submission?.assignment.lesson.id,
        lessonTitle: submission?.assignment.lesson.title,
        gradeFeedback: grade?.feedback ?? undefined,
        recipientEmail: contact.recipientEmail,
        learnerName: contact.learnerName,
      };
    }

    case OUTBOX_TOPICS.certificateIssued: {
      const parsed = certificateIssuedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return {};
      // 1 query: recipient contact (verify URL derives from the payload code).
      const contact = await resolveUserContact(parsed.data.userId);
      return {
        recipientEmail: contact.recipientEmail,
        learnerName: contact.learnerName,
        verifyUrl: absoluteEmailUrl(`/certificates/${parsed.data.code}`),
      };
    }

    case OUTBOX_TOPICS.discussionThreadReplied: {
      const parsed = discussionThreadRepliedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return {};
      // 1 query: the reply's thread (author + title + moderation status) and
      // the lesson title in one include, with the course joined in parallel
      // via the payload's courseId (Lesson has no course relation, only the
      // denormalized courseId); then 1 query for the author's contact.
      const [post, course] = await Promise.all([
        db.discussionPost.findUnique({
          where: { id: event.aggregateId },
          select: {
            body: true,
            thread: {
              select: {
                userId: true,
                title: true,
                status: true,
                lesson: { select: { id: true, title: true } },
              },
            },
          },
        }),
        db.course.findUnique({ where: { id: parsed.data.courseId }, select: { slug: true, title: true } }),
      ]);
      if (!post) return {};
      const contact = await resolveUserContact(post.thread.userId);
      return {
        threadAuthorUserId: post.thread.userId,
        threadTitle: post.thread.title,
        threadStatus: post.thread.status,
        replyExcerpt: post.body,
        courseSlug: course?.slug,
        courseTitle: course?.title,
        lessonId: post.thread.lesson.id,
        lessonTitle: post.thread.lesson.title,
        threadUrl: absoluteEmailUrl(
          `/learning/${course?.slug ?? parsed.data.courseId}/${parsed.data.lessonId}`,
        ),
        recipientEmail: contact.recipientEmail,
      };
    }

    case OUTBOX_TOPICS.discussionThreadCreated: {
      const parsed = discussionThreadCreatedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return {};
      // 2 queries (parallel): the platform owner for the digest + the course
      // title/slug for a human notification and a deep link.
      const [settings, course] = await Promise.all([
        db.platformSettings.findUnique({ where: { id: "platform" }, select: { ownerUserId: true } }),
        db.course.findUnique({ where: { id: parsed.data.courseId }, select: { slug: true, title: true } }),
      ]);
      return {
        ownerUserId: settings?.ownerUserId,
        courseSlug: course?.slug,
        courseTitle: course?.title,
      };
    }

    case OUTBOX_TOPICS.reviewOwnerReplied: {
      const parsed = reviewOwnerRepliedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return {};
      // 2 queries (parallel): course slug/title (the payload carries no slug)
      // + the review author's contact for the email.
      const [course, contact] = await Promise.all([
        db.course.findUnique({ where: { id: parsed.data.courseId }, select: { slug: true, title: true } }),
        resolveUserContact(parsed.data.authorUserId),
      ]);
      return {
        courseSlug: course?.slug,
        courseTitle: course?.title,
        courseUrl: course ? absoluteEmailUrl(`/courses/${course.slug}`) : undefined,
        recipientEmail: contact.recipientEmail,
        learnerName: contact.learnerName,
      };
    }

    default:
      // course.completed (and any no-op topic) plan purely from the payload.
      return {};
  }
}

// ---------------------------------------------------------------------------
// Application + the dispatch loop (impure).
// ---------------------------------------------------------------------------

/** Clamps projected values to the Notification column limits (no magic values). */
function clampText(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= max ? value : value.slice(0, max - 1).trimEnd() + "…";
}

interface ApplyOutcome {
  notificationsCreated: number;
  emailsSent: number;
  suppressedEmails: number;
}

/**
 * Notifications first (durable, deduplicated), email second (best-effort).
 * If notification creation fails the event retries and the email never went
 * out — the ordering guarantees no email without its in-app record.
 */
async function applyOutboxPlan(event: OutboxEventRow, plan: EventPlan): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { notificationsCreated: 0, emailsSent: 0, suppressedEmails: 0 };

  if (plan.notifications.length > 0) {
    const dedupeBase = event.eventKey ?? `outbox:${event.id}`;
    const data = plan.notifications.map((notification) => ({
      userId: notification.userId,
      topic: notification.topic,
      title: clampText(notification.title, NOTIFICATION_TITLE_MAX) ?? notification.title,
      body: clampText(notification.body, NOTIFICATION_BODY_MAX) ?? null,
      linkPath: clampText(notification.linkPath, NOTIFICATION_LINK_MAX) ?? null,
      dedupeKey: `${dedupeBase}:${notification.dedupeKeySuffix}`,
    }));
    try {
      // skipDuplicates makes the projection at-most-once: a replayed event
      // collides on the unique dedupeKey and inserts nothing (PG reports only
      // the rows actually created, so the count stays honest).
      const created = await db.notification.createMany({ data, skipDuplicates: true });
      outcome.notificationsCreated = created.count;
    } catch (error) {
      // Belt-and-braces for drivers that surface the collision as P2002
      // instead of honouring DO NOTHING: the row already exists, treat as done.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        logger.debug("Notification dedupeKey race resolved as already-created", {
          eventKey: event.eventKey,
        });
      } else {
        throw error;
      }
    }
  }

  if (plan.email) {
    const rendered = renderOutboxEmail(plan.email);
    const sendOutcome = await sendWithSuppressionCheck({
      to: plan.email.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    if (sendOutcome === "sent") outcome.emailsSent = 1;
    else outcome.suppressedEmails = 1; // suppression is expected + permanent: event still completes
  }

  return outcome;
}

/** One event: resolve -> plan -> apply. Throws for the retry policy to classify. */
async function handleOutboxEvent(event: OutboxEventRow): Promise<ApplyOutcome> {
  const resolution = await resolveOutboxContext(event);
  const plan = planOutboxEvent(event.topic, event.payload, resolution);
  if (!plan) return { notificationsCreated: 0, emailsSent: 0, suppressedEmails: 0 };
  return await applyOutboxPlan(event, plan);
}

/**
 * One dispatcher sweep. Never throws per-event: failures are retried,
 * backoff-scheduled or FAILED per the retry policy and aggregated into the
 * result. Only a database outage propagates to the caller.
 */
async function runOutboxDispatchSweep(options: { limit?: number } = {}): Promise<DispatchResult> {
  const limit = options.limit ?? DEFAULT_DISPATCH_LIMIT;
  const result: DispatchResult = {
    processed: 0,
    completed: 0,
    failed: 0,
    suppressedEmails: 0,
    notificationsCreated: 0,
    emailsSent: 0,
  };

  // Opportunistic retention sweep: cheap, self-healing, and must never block
  // dispatch (a failing sweep logs and moves on).
  try {
    await purgeExpiredContactBodies();
  } catch (error) {
    logger.warn("Contact retention sweep failed during outbox dispatch", { error });
  }

  const events = await db.outboxEvent.findMany({
    where: { status: OutboxStatus.PENDING, availableAt: { lte: new Date() } },
    orderBy: [{ availableAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      eventKey: true,
      topic: true,
      aggregateType: true,
      aggregateId: true,
      payload: true,
      attempts: true,
    },
  });

  for (const event of events) {
    // Non-locking claim: only a PENDING row flips to PROCESSING; a lost claim
    // simply means another worker took it.
    const claimed = await db.outboxEvent.updateMany({
      where: { id: event.id, status: OutboxStatus.PENDING },
      data: { status: OutboxStatus.PROCESSING },
    });
    if (claimed.count === 0) continue;
    result.processed += 1;
    recordOutboxEvent("claimed");

    try {
      const outcome = await handleOutboxEvent(event);
      await db.outboxEvent.updateMany({
        where: { id: event.id, status: OutboxStatus.PROCESSING },
        data: {
          status: OutboxStatus.COMPLETED,
          processedAt: new Date(),
          attempts: { increment: 1 },
          lastError: null,
        },
      });
      result.completed += 1;
      recordOutboxEvent("completed");
      result.notificationsCreated += outcome.notificationsCreated;
      result.emailsSent += outcome.emailsSent;
      result.suppressedEmails += outcome.suppressedEmails;
    } catch (error) {
      const nextAttempts = event.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof EmailDeliveryError && error.permanent;

      if (permanent || nextAttempts >= MAX_OUTBOX_ATTEMPTS) {
        await db.outboxEvent.updateMany({
          where: { id: event.id, status: OutboxStatus.PROCESSING },
          data: {
            status: OutboxStatus.FAILED,
            attempts: { increment: 1 },
            lastError: message,
          },
        });
        result.failed += 1;
        recordOutboxEvent("failed");
        logger.error("Outbox event failed permanently", {
          eventId: event.id,
          topic: event.topic,
          attempts: nextAttempts,
          error,
        });
      } else {
        const availableAt = new Date(Date.now() + outboxBackoffMs(nextAttempts));
        await db.outboxEvent.updateMany({
          where: { id: event.id, status: OutboxStatus.PROCESSING },
          data: {
            status: OutboxStatus.PENDING,
            attempts: { increment: 1 },
            availableAt,
            lastError: message,
          },
        });
        logger.warn("Outbox event scheduled for retry", {
          eventId: event.id,
          topic: event.topic,
          attempts: nextAttempts,
          availableAt: availableAt.toISOString(),
        });
      }
    }
  }

  return result;
}

/**
 * Public sweep entry: wraps the run in a single "outbox.dispatch" span that
 * carries the claimed/completed/failed counts (one line per batch, not per
 * event).
 */
export async function dispatchPendingOutbox(options: { limit?: number } = {}): Promise<DispatchResult> {
  const spanAttrs: Record<string, unknown> = {};
  return withSpan("outbox.dispatch", spanAttrs, async () => {
    const result = await runOutboxDispatchSweep(options);
    spanAttrs.claimed = result.processed;
    spanAttrs.completed = result.completed;
    spanAttrs.failed = result.failed;
    return result;
  });
}

/**
 * Fire-and-forget wrapper for request paths: callers spread `void
 * triggerBackgroundDispatch()` and never await it; failures are logged, never
 * surfaced to the request.
 */
export async function triggerBackgroundDispatch(): Promise<void> {
  try {
    await dispatchPendingOutbox();
  } catch (error) {
    recordJobFailure("outbox.dispatch");
    logger.error("Background outbox dispatch failed", { error });
  }
}
