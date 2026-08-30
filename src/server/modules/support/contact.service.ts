import type { z } from "zod";
import {
  CONTACT_RETENTION_DAYS,
  CONTACT_SPAM_REJECTED,
  contactSubmissionSchema,
} from "@/contracts/support";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import {
  buildSupportNotificationEmail,
  renderExcerpt,
} from "@/server/email/email.logic";
import { sendWithSuppressionCheck } from "@/server/email/email-port";
import { logger } from "@/server/observability/logger";
import { assessContactSpam, contactRetentionCutoff } from "@/server/modules/support/contact.logic";

// Public support contact: anonymous writes are the highest-abuse surface in
// the app, so the trust model is layered — transport-level rate limiting at
// the route (per hashed client identity), a honeypot + link heuristic here,
// and a retention sweep that nulls message fields after
// CONTACT_RETENTION_DAYS while keeping rows for abuse counting.

export type ContactSubmissionInput = z.infer<typeof contactSubmissionSchema>;

export interface ContactRequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

const SUPPORT_MESSAGE_EXCERPT_LENGTH = 280;
const PLATFORM_SETTINGS_ID = "platform";

/**
 * Persists a public contact submission. The spam decision is made BEFORE any
 * write and rejected with a single generic message: the response never says
 * which control tripped (no oracle for bots to probe).
 *
 * Query budget: 2 writes in one tx (submission + audit) + 1 read (support
 * recipient) + fire-and-forget email.
 */
export async function submitContact(
  input: ContactSubmissionInput,
  meta: ContactRequestMeta,
  requestId: string,
): Promise<{ id: string }> {
  if (assessContactSpam({ website: input.website, message: input.message })) {
    throw new ApiError(
      422,
      CONTACT_SPAM_REJECTED,
      "The submission was rejected.",
    );
  }

  const created = await withTransaction(async (tx) => {
    const row = await tx.contactSubmission.create({
      data: {
        name: input.name,
        email: input.email,
        subject: input.subject,
        message: input.message,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
      select: { id: true },
    });
    // metadata records that the submission passed the spam assessment (no
    // rejection); the mechanism itself is never described here.
    await tx.auditLog.create({
      data: {
        action: "contact.submitted",
        entityType: "ContactSubmission",
        entityId: row.id,
        requestId,
        metadata: { spamAssessed: false },
      },
      select: { id: true },
    });
    return row;
  });

  void notifySupportOfSubmission(created.id, input);
  return { id: created.id };
}

/**
 * Fire-and-forget support notification: resolves the recipient once
 * (PlatformSettings.supportEmail, falling back to the owner's account email),
 * then sends OUTSIDE any transaction. A failure here is logged and dropped —
 * it must never fail the already-committed submission (the row IS the
 * request's durable record; support can also see it in the owner console).
 */
async function notifySupportOfSubmission(submissionId: string, input: ContactSubmissionInput): Promise<void> {
  try {
    const settings = await db.platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
      select: { supportEmail: true, owner: { select: { email: true } } },
    });
    const recipient = settings?.supportEmail ?? settings?.owner.email;
    if (!recipient) {
      logger.warn("Support notification skipped: no supportEmail or owner email configured", {
        submissionId,
      });
      return;
    }

    const content = buildSupportNotificationEmail({
      submissionId,
      name: input.name,
      email: input.email,
      subject: input.subject,
      messageExcerpt: renderExcerpt(input.message, SUPPORT_MESSAGE_EXCERPT_LENGTH),
      createdAt: new Date().toISOString(),
    });
    await sendWithSuppressionCheck({
      to: recipient,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  } catch (error) {
    logger.error("Support notification email failed", { submissionId, error });
  }
}

/**
 * Retention sweep: nulls the personal message fields of submissions older
 * than CONTACT_RETENTION_DAYS (rows remain for abuse counting). Constant-driven
 * and idempotent (purgedAt gate) so it can run opportunistically.
 */
export async function purgeExpiredContactBodies(): Promise<number> {
  const purgedAt = new Date();
  const cutoff = contactRetentionCutoff(purgedAt, CONTACT_RETENTION_DAYS);
  const result = await db.contactSubmission.updateMany({
    where: { createdAt: { lt: cutoff }, purgedAt: null },
    data: {
      name: null,
      email: null,
      subject: null,
      message: null,
      purgedAt,
    },
  });
  if (result.count > 0) {
    logger.info("Expired contact submissions purged", { count: result.count });
  }
  return result.count;
}
