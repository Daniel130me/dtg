import { escapeHtml } from "@/server/email/email.logic";
import {
  resetSmtpEmailPortForTests,
  sendWithSuppressionCheck,
} from "@/server/email/email-port";

// Authentication emails (verification + password reset). The transport,
// suppression check and error classification now live behind the shared
// email port; this module only keeps its historical message formatting so
// existing auth flows behave exactly as before (auth.ts already soft-fails
// delivery errors via its sendEmailSafely wrapper).

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

  // The port keeps the historical test-environment no-op (no db, no SMTP) and
  // never lets an email failure roll back the surrounding auth flow.
  await sendWithSuppressionCheck({
    to: input.to,
    subject: input.subject,
    text: `${input.intro}\n\n${input.actionLabel}: ${input.actionUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${safeIntro}</p><p><a href="${safeUrl}">${safeLabel}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

export function resetEmailTransportForTests(): void {
  resetSmtpEmailPortForTests();
}
