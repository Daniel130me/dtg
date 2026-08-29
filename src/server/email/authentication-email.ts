import nodemailer, { type Transporter } from "nodemailer";
import { getServerEnv } from "@/server/config/env";

let transporter: Transporter | undefined;

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
  });
  return transporter;
}

export interface AuthenticationEmailInput {
  to: string;
  subject: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
}

export async function sendAuthenticationEmail(input: AuthenticationEmailInput): Promise<void> {
  if (process.env.NODE_ENV === "test") return;

  const env = getServerEnv();
  if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM is not configured.");

  const safeIntro = escapeHtml(input.intro);
  const safeLabel = escapeHtml(input.actionLabel);
  const safeUrl = escapeHtml(input.actionUrl);

  await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    text: `${input.intro}\n\n${input.actionLabel}: ${input.actionUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${safeIntro}</p><p><a href="${safeUrl}">${safeLabel}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

export function resetEmailTransportForTests(): void {
  transporter = undefined;
}
