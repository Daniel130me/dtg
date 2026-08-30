import nodemailer, { type Transporter } from "nodemailer";
import { getServerEnv } from "@/server/config/env";
import { db } from "@/server/db/client";
import { classifyEmailError, normalizeRecipientEmail } from "@/server/email/email.logic";
import { recordEmailSent } from "@/server/observability/metrics";
import { logger } from "@/server/observability/logger";
import { withSpan } from "@/server/observability/trace";
import { CircuitBreaker } from "@/server/resilience/circuit-breaker";
import { ResilienceError } from "@/server/resilience/errors";
import { withRetries } from "@/server/resilience/retry";
import { withTimeout } from "@/server/resilience/timeout";

// ---------------------------------------------------------------------------
// The provider port for transactional email. Everything downstream (auth
// emails, the outbox dispatcher, support notifications) sends through
// sendWithSuppressionCheck so the suppression list and SMTP error
// classification live in exactly one place.
//
// Trust model: email is NEVER sent inside a domain transaction — callers
// persist their writes first and treat email failure as non-fatal, so an SMTP
// outage can never roll back enrolments, grades or submissions.
//
// Resilience (Phase 12): each SMTP send is bounded by a 10s timeout, retried
// once (2 attempts total) for transient (non-permanent) faults, and guarded by
// a module-level circuit breaker that opens after 5 consecutive non-permanent
// failures. An OPEN breaker throws a transient EmailDeliveryError so the
// outbox treats it as retryable-FAILED exactly like any SMTP outage.
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
const EMAIL_SEND_TIMEOUT_MS = 10_000;
const EMAIL_SEND_ATTEMPTS = 2;
const EMAIL_BREAKER_FAILURE_THRESHOLD = 5;
const EMAIL_BREAKER_RESET_TIMEOUT_MS = 30_000;

// Permanent errors do NOT count as breaker failures: they would fail again
// with the circuit closed, so tripping on them would only mask the real cause.
const emailCircuitBreaker = new CircuitBreaker({
  failureThreshold: EMAIL_BREAKER_FAILURE_THRESHOLD,
  resetTimeoutMs: EMAIL_BREAKER_RESET_TIMEOUT_MS,
  failurePredicate: (error) => (error instanceof EmailDeliveryError ? !error.permanent : true),
});

/** Recipient DOMAIN only — full addresses must never reach logs/spans. */
function recipientDomain(email: string): string {
  const domain = normalizeRecipientEmail(email).split("@").pop();
  return domain ? domain : "unknown";
}

/** Transient faults (SMTP timeouts, connection drops) are worth one retry. */
function isTransientEmailError(error: unknown): boolean {
  if (error instanceof ResilienceError) return error.code === "TIMEOUT";
  if (error instanceof EmailDeliveryError) return !error.permanent;
  return !classifyEmailError(error);
}

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

      // The span attrs object is spread at log time, so setting `permanent`
      // inside the catch makes the span line carry the classification.
      const spanAttrs: Record<string, unknown> = { toDomain: recipientDomain(email.to) };
      await withSpan("email.send", spanAttrs, async () => {
        try {
          await emailCircuitBreaker.execute(async () => {
            try {
              await withRetries(
                () =>
                  withTimeout(
                    EMAIL_SEND_TIMEOUT_MS,
                    "email.send",
                    () =>
                      getSmtpTransporter().sendMail({
                        from: env.EMAIL_FROM,
                        to: email.to,
                        subject: email.subject,
                        text: email.text,
                        html: email.html,
                      }),
                  ),
                { attempts: EMAIL_SEND_ATTEMPTS, retryable: isTransientEmailError },
              );
            } catch (error) {
              // Open breaker -> transient, so the outbox retries later.
              if (error instanceof ResilienceError && error.code === "CIRCUIT_OPEN") {
                throw new EmailDeliveryError("Email delivery temporarily unavailable.", false);
              }
              throw error;
            }
          });
        } catch (error) {
          spanAttrs.permanent = error instanceof EmailDeliveryError ? error.permanent : false;
          if (error instanceof EmailDeliveryError) throw error;
          if (error instanceof ResilienceError) {
            throw new EmailDeliveryError(
              error.code === "TIMEOUT" ? "Email delivery timed out." : "Email delivery temporarily unavailable.",
              false,
            );
          }
          const message = error instanceof Error ? error.message : String(error);
          throw new EmailDeliveryError(message, classifyEmailError(error));
        }
      });
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
    recordEmailSent("suppressed");
    return "suppressed";
  }

  try {
    await createSmtpEmailPort().send(email);
  } catch (error) {
    recordEmailSent("failed");
    throw error;
  }
  recordEmailSent("sent");
  return "sent";
}
