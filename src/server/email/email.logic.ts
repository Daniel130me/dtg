import { getServerEnv } from "@/server/config/env";

// ---------------------------------------------------------------------------
// Pure email helpers: escaping, excerpting, error classification and template
// builders. No database, no transport — everything here is deterministic
// string work and unit-testable by design. The single deliberate environment
// read is APP_URL (for absolute action links); tests run with the documented
// inline DATABASE_URL/APP_URL exports like every other suite.
// ---------------------------------------------------------------------------

export const EMAIL_BRAND_NAME = "DTG";
export const EMAIL_FOOTER_TEXT =
  "You are receiving this because you have a DTG account. Manage notifications in your profile.";

const DEFAULT_EXCERPT_LENGTH = 120;

/** Colours are static brand tokens; inline styles keep clients honest. */
const BRAND_COLOR = "#0a1a3e";
const BODY_COLOR = "#374151";
const MUTED_COLOR = "#6b7280";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Escapes the five HTML-significant characters (same map as the legacy auth email). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

/** The suppression list and better-auth both key emails trimmed + lowercased. */
export function normalizeRecipientEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Collapses whitespace and truncates with an ellipsis (never mid-surrogate). */
export function renderExcerpt(text: string, max: number = DEFAULT_EXCERPT_LENGTH): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const limit = Math.max(0, max - 1);
  return `${collapsed.slice(0, limit).trimEnd()}…`;
}

/** Subjects must never carry CR/LF (header injection); titles can be hostile. */
export function sanitizeEmailSubject(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Permanent = retrying can never succeed. Hard SMTP rejection codes (550/551/553),
 * recipient-rejected / user-unknown wording, and missing configuration are permanent;
 * everything else (timeouts, 4xx greylisting, connection drops) is transient.
 */
const PERMANENT_SMTP_CODE_PATTERN = /\b(?:550|551|553)\b/;
const PERMANENT_SMTP_MESSAGE_PATTERN =
  /recipient (?:address )?(?:was )?(?:rejected|failed)|invalid recipient|user unknown|no mailbox|address does not exist|not configured/i;

/** True (permanent) when re-delivery of this error can never succeed. */
export function classifyEmailError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return PERMANENT_SMTP_CODE_PATTERN.test(message) || PERMANENT_SMTP_MESSAGE_PATTERN.test(message);
}

// ---------------------------------------------------------------------------
// Shared layout
// ---------------------------------------------------------------------------

/** Joins an absolute path onto the configured APP_URL (the one env read here). */
export function absoluteEmailUrl(path: string): string {
  const base = getServerEnv().APP_URL.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

interface EmailLayoutInput {
  heading: string;
  /** Pre-built, already-escaped body fragments. */
  bodyHtml: string;
  actionLabel?: string;
  actionUrl?: string;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${BODY_COLOR}">${escapeHtml(text)}</p>`;
}

function renderActionHtml(actionLabel: string, actionUrl: string): string {
  const safeLabel = escapeHtml(actionLabel);
  const safeUrl = escapeHtml(actionUrl);
  return [
    `<p style="margin:24px 0 0">`,
    `<a href="${safeUrl}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600">${safeLabel}</a>`,
    `</p>`,
    `<p style="margin:12px 0 0;font-size:12px;color:${MUTED_COLOR};word-break:break-all">${safeUrl}</p>`,
  ].join("");
}

/**
 * Minimal branded layout (table-free, inline-styled — the common denominator
 * across mail clients we support). Every interpolated value is escaped.
 */
export function renderEmailLayout(input: EmailLayoutInput): string {
  const heading = escapeHtml(input.heading);
  const action =
    input.actionLabel && input.actionUrl ? renderActionHtml(input.actionLabel, input.actionUrl) : "";
  return [
    `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;padding:24px">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px">`,
    `<p style="margin:0 0 16px;font-size:12px;letter-spacing:2px;color:${BRAND_COLOR};font-weight:700">${EMAIL_BRAND_NAME}</p>`,
    `<h1 style="margin:0 0 16px;font-size:20px;color:${BRAND_COLOR}">${heading}</h1>`,
    input.bodyHtml,
    action,
    `<p style="margin:24px 0 0;font-size:12px;color:${MUTED_COLOR};border-top:1px solid #e5e7eb;padding-top:16px">${EMAIL_FOOTER_TEXT}</p>`,
    `</div>`,
    `</div>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Template builders (no db, no transport — the dispatcher/auth email decide when)
// ---------------------------------------------------------------------------

export function buildVerificationEmail(input: { url: string; displayName?: string }): EmailContent {
  const greeting = input.displayName ? `Hi ${input.displayName},` : "Hi,";
  return {
    subject: sanitizeEmailSubject("Verify your email — DTG"),
    text: `${greeting}\n\nConfirm your email address to activate your DTG account.\n\nVerify email: ${input.url}\n\nIf you did not request this, you can ignore this email.`,
    html: renderEmailLayout({
      heading: "Verify your email address",
      bodyHtml:
        paragraph(greeting) +
        paragraph("Confirm your email address to activate your DTG account."),
      actionLabel: "Verify email",
      actionUrl: input.url,
    }),
  };
}

export function buildPasswordResetEmail(input: { url: string; displayName?: string }): EmailContent {
  const greeting = input.displayName ? `Hi ${input.displayName},` : "Hi,";
  return {
    subject: sanitizeEmailSubject("Reset your password — DTG"),
    text: `${greeting}\n\nA password reset was requested for your DTG account.\n\nReset password: ${input.url}\n\nIf you did not request this, you can ignore this email.`,
    html: renderEmailLayout({
      heading: "Reset your password",
      bodyHtml:
        paragraph(greeting) + paragraph("A password reset was requested for your DTG account."),
      actionLabel: "Reset password",
      actionUrl: input.url,
    }),
  };
}

export function buildEnrolmentConfirmedEmail(input: {
  courseTitle: string;
  courseSlug: string;
  learnerName?: string;
}): EmailContent {
  const courseUrl = absoluteEmailUrl(`/learning/${input.courseSlug}`);
  const greeting = input.learnerName ? `Hi ${input.learnerName},` : "Hi,";
  return {
    subject: sanitizeEmailSubject(`You're enrolled in ${input.courseTitle}`),
    text: `${greeting}\n\nYour seat in ${input.courseTitle} is confirmed.\n\nStart learning now — your classroom is ready.\n\nGo to your classroom: ${courseUrl}`,
    html: renderEmailLayout({
      heading: "You're enrolled",
      bodyHtml:
        paragraph(`${greeting} Your seat in ${input.courseTitle} is confirmed.`) +
        paragraph("Start learning now — your classroom is ready."),
      actionLabel: "Go to your classroom",
      actionUrl: courseUrl,
    }),
  };
}

export function buildAssignmentGradedEmail(input: {
  courseTitle: string;
  lessonTitle: string;
  score: number;
  maxPoints: number;
  feedback?: string;
}): EmailContent {
  const feedbackHtml = input.feedback ? paragraph(`Instructor feedback: ${input.feedback}`) : "";
  const feedbackText = input.feedback ? `\n\nInstructor feedback: ${input.feedback}` : "";
  return {
    subject: sanitizeEmailSubject(`Assignment graded: ${input.score}/${input.maxPoints} — ${input.courseTitle}`),
    text: `Your assignment for ${input.lessonTitle} in ${input.courseTitle} has been graded: ${input.score}/${input.maxPoints}.${feedbackText}`,
    html: renderEmailLayout({
      heading: `Assignment graded: ${input.score}/${input.maxPoints}`,
      bodyHtml:
        paragraph(`Your assignment for ${input.lessonTitle} in ${input.courseTitle} has been graded.`) +
        feedbackHtml,
    }),
  };
}

export function buildAssignmentReturnedEmail(input: {
  courseTitle: string;
  lessonTitle: string;
  feedback: string;
}): EmailContent {
  return {
    subject: sanitizeEmailSubject(`Revision requested: ${input.lessonTitle} — ${input.courseTitle}`),
    text: `Your submission for "${input.lessonTitle}" in ${input.courseTitle} was returned for revision.\n\nInstructor feedback: ${input.feedback}\n\nRevise and resubmit from your classroom.`,
    html: renderEmailLayout({
      heading: "Revision requested",
      bodyHtml:
        paragraph(
          `Your submission for "${input.lessonTitle}" in ${input.courseTitle} was returned for revision.`,
        ) +
        paragraph(`Instructor feedback: ${input.feedback}`) +
        paragraph("Revise and resubmit from your classroom."),
    }),
  };
}

export function buildCertificateIssuedEmail(input: {
  courseTitle: string;
  verifyUrl: string;
  certificateCode: string;
}): EmailContent {
  return {
    subject: sanitizeEmailSubject(`Your certificate for ${input.courseTitle} is ready`),
    text: `Congratulations — you completed ${input.courseTitle}!\n\nCertificate code: ${input.certificateCode}\nVerify or share it here: ${input.verifyUrl}`,
    html: renderEmailLayout({
      heading: "Your certificate is ready",
      bodyHtml:
        paragraph(`Congratulations — you completed ${input.courseTitle}!`) +
        paragraph(`Certificate code: ${input.certificateCode}`),
      actionLabel: "Verify certificate",
      actionUrl: input.verifyUrl,
    }),
  };
}

export function buildDiscussionReplyEmail(input: {
  courseTitle: string;
  lessonTitle: string;
  threadTitle: string;
  replyExcerpt: string;
  threadUrl: string;
}): EmailContent {
  return {
    subject: sanitizeEmailSubject(`New reply: ${input.threadTitle}`),
    text: `Someone replied to your question "${input.threadTitle}" (${input.lessonTitle}, ${input.courseTitle}):\n\n${input.replyExcerpt}\n\nRead the full discussion: ${input.threadUrl}`,
    html: renderEmailLayout({
      heading: "New reply to your question",
      bodyHtml:
        paragraph(`Someone replied to "${input.threadTitle}" (${input.lessonTitle}, ${input.courseTitle}):`) +
        paragraph(`"${input.replyExcerpt}"`),
      actionLabel: "Open the discussion",
      actionUrl: input.threadUrl,
    }),
  };
}

export function buildReviewReplyEmail(input: {
  courseTitle: string;
  replyExcerpt: string;
  courseUrl: string;
}): EmailContent {
  return {
    subject: sanitizeEmailSubject(`The instructor replied to your review of ${input.courseTitle}`),
    text: `The instructor replied to your review of ${input.courseTitle}:\n\n${input.replyExcerpt}\n\nRead the reply: ${input.courseUrl}`,
    html: renderEmailLayout({
      heading: "The instructor replied to your review",
      bodyHtml:
        paragraph(`The instructor replied to your review of ${input.courseTitle}:`) +
        paragraph(`"${input.replyExcerpt}"`),
      actionLabel: "Read the reply",
      actionUrl: input.courseUrl,
    }),
  };
}

export function buildSupportNotificationEmail(input: {
  submissionId: string;
  name: string;
  email: string;
  subject: string;
  messageExcerpt: string;
  createdAt: string;
}): EmailContent {
  return {
    subject: sanitizeEmailSubject(`New support message: ${input.subject}`),
    text: `A new support message arrived.\n\nFrom: ${input.name} <${input.email}>\nReceived: ${input.createdAt}\nSubmission: ${input.submissionId}\n\n${input.messageExcerpt}`,
    html: renderEmailLayout({
      heading: "New support message",
      bodyHtml:
        paragraph(`From: ${input.name} <${input.email}>`) +
        paragraph(`Received: ${input.createdAt} · Submission: ${input.submissionId}`) +
        paragraph(`"${input.messageExcerpt}"`),
    }),
  };
}
