import { escapeHtml } from "@/server/email/email.logic";
import {
  resetSmtpEmailPortForTests,
  sendWithSuppressionCheck,
} from "@/server/email/email-port";

<<<<<<< HEAD
// Authentication emails (verification + password reset). The transport,
// suppression check and error classification now live behind the shared
// email port; this module only keeps its historical message formatting so
// existing auth flows behave exactly as before (auth.ts already soft-fails
// delivery errors via its sendEmailSafely wrapper).
=======
let transporter: Transporter | undefined;

const SEND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

function resetTransporter(): void {
  try {
    transporter?.close();
  } catch {
    // Ignore close errors on an already-broken connection.
  }
  transporter = undefined;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const env = getServerEnv();
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw new Error("SMTP is not configured.");
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    pool: true,
    maxConnections: 3,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transporter;
}
>>>>>>> ce2a251 (feat(student-data): implement StudentDataProvider for managing enrolments, certificates, and notifications)

export interface AuthenticationEmailInput {
  to: string;
  subject: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
}

export async function sendAuthenticationEmail(input: AuthenticationEmailInput): Promise<void> {
  const safeIntro = escapeHtml(input.intro);
  const safeLabel = escapeHtml(input.actionLabel);
  const safeUrl = escapeHtml(input.actionUrl);

<<<<<<< HEAD
  // The port keeps the historical test-environment no-op (no db, no SMTP) and
  // never lets an email failure roll back the surrounding auth flow.
  await sendWithSuppressionCheck({
    to: input.to,
    subject: input.subject,
    text: `${input.intro}\n\n${input.actionLabel}: ${input.actionUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${safeIntro}</p><p><a href="${safeUrl}">${safeLabel}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
=======
  // Gmail SMTP connections from this machine intermittently stall before the
  // server greeting arrives, so retry on a fresh connection before giving up.
  let lastError: unknown;
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    try {
      await getTransporter().sendMail({
        from: env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        text: `${input.intro}\n\n${input.actionLabel}: ${input.actionUrl}\n\nIf you did not request this, you can ignore this email.`,
        html: `<p>${safeIntro}</p><p><a href="${safeUrl}">${safeLabel}</a></p><p>If you did not request this, you can ignore this email.</p>`,
      });
      return;
    } catch (error) {
      lastError = error;
      resetTransporter();
      if (attempt < SEND_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError;
>>>>>>> ce2a251 (feat(student-data): implement StudentDataProvider for managing enrolments, certificates, and notifications)
}

export function resetEmailTransportForTests(): void {
  resetSmtpEmailPortForTests();
}
