import nodemailer, { type Transporter } from "nodemailer";
import { getServerEnv } from "@/server/config/env";
import { db } from "@/server/db/client";
import { classifyEmailError, normalizeRecipientEmail } from "@/server/email/email.logic";
import { logger } from "@/server/observability/logger";

// ---------------------------------------------------------------------------
// The provider port for transactional email. Everything downstream (auth
// emails, the outbox dispatcher, support notifications) sends through
// sendWithSuppressionCheck so the suppression list and SMTP error
// classification live in exactly one place.
//
// Trust model: email is NEVER sent inside a domain transaction — callers
// persist their writes first and treat email failure as non-fatal, so an SMTP
// outage can never roll back enrolments, grades or submissions.
// ---------------------------------------------------------------------------

export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailPort {
  send(email: TransactionalEmail): Promise<void>;
}

/**
 * permanent=true marks errors that can never succeed on retry (missing
 * config, hard 5xx rejections, invalid recipients). The outbox dispatcher
 * FAILs those events immediately instead of burning retries.
 */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    public readonly permanent: boolean,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

const TEST_ENVIRONMENT = "test";

let transporter: Transporter | undefined;

function getSmtpTransporter(): Transporter {
  if (transporter) return transporter;

  const env = getServerEnv();
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    // Retrying without configuration can never succeed -> permanent.
    throw new EmailDeliveryError("SMTP is not configured.", true);
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    pool: true,
    maxConnections: 3,
  });
  return transporter;
}

/**
 * Lazy SMTP singleton (created on first send, not at import). In the test
 * environment send resolves without side effects — the historical behaviour
 * of sendAuthenticationEmail — so unit/integration tests never open sockets.
 */
export function createSmtpEmailPort(): EmailPort {
  return {
    async send(email: TransactionalEmail): Promise<void> {
      if (process.env.NODE_ENV === TEST_ENVIRONMENT) return;

      const env = getServerEnv();
      if (!env.EMAIL_FROM) {
        throw new EmailDeliveryError("EMAIL_FROM is not configured.", true);
      }

      try {
        await getSmtpTransporter().sendMail({
          from: env.EMAIL_FROM,
          to: email.to,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new EmailDeliveryError(message, classifyEmailError(error));
      }
    },
  };
}

/** Test seam: drops the pooled transport so a new one is built on next send. */
export function resetSmtpEmailPortForTests(): void {
  transporter = undefined;
}

/**
 * The one send gateway. Suppressed recipients are logged and skipped (a
 * permanent, expected outcome — callers still count their job as done).
 * Runs OUTSIDE any domain transaction by contract.
 */
export async function sendWithSuppressionCheck(email: TransactionalEmail): Promise<"sent" | "suppressed"> {
  // Test environments short-circuit before the database lookup so tests never
  // need a live DB just to exercise email-sending code paths.
  if (process.env.NODE_ENV === TEST_ENVIRONMENT) return "sent";

  const recipient = normalizeRecipientEmail(email.to);
  const suppression = await db.emailSuppression.findUnique({
    where: { email: recipient },
    select: { reason: true },
  });
  if (suppression) {
    logger.warn("Transactional email suppressed", { to: recipient, reason: suppression.reason });
    return "suppressed";
  }

  await createSmtpEmailPort().send(email);
  return "sent";
}
