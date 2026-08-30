import { z } from "zod";

// ---------------------------------------------------------------------------
// Named constants (no magic values)
// ---------------------------------------------------------------------------

export const CONTACT_NAME_MAX = 120;
export const CONTACT_EMAIL_MAX = 320;
export const CONTACT_SUBJECT_MAX = 200;
export const CONTACT_MESSAGE_MAX = 5000;

/**
 * Retention: a sweep nulls the message fields (name/email/subject/message)
 * of submissions older than this many days; rows remain for abuse counting.
 */
export const CONTACT_RETENTION_DAYS = 90;

/**
 * Honeypot field name. The public form renders it hidden and empty; bots that
 * fill it are rejected. Never render a server-side hint of this mechanism.
 */
export const CONTACT_HONEYPOT_FIELD = "website";

/** Spam heuristic: submissions with more distinct links than this are rejected. */
export const CONTACT_MAX_LINKS = 3;

/** Client-matchable error codes shared by server and client. */
export const CONTACT_SPAM_REJECTED = "CONTACT_SPAM_REJECTED";
export const CONTACT_RETAINED_TOO_LONG = "CONTACT_RETENTION_WINDOW_INVALID";

// ---------------------------------------------------------------------------
// Input contracts
// ---------------------------------------------------------------------------

/**
 * Public contact payload. `website` is the honeypot: absent or empty on a
 * human submission; any value is spam. Validation is deliberately generic so
 * error copy never confirms which control tripped.
 */
export const contactSubmissionSchema = z.object({
  name: z.string().trim().min(1).max(CONTACT_NAME_MAX),
  email: z.email().max(CONTACT_EMAIL_MAX),
  subject: z.string().trim().min(1).max(CONTACT_SUBJECT_MAX),
  message: z.string().trim().min(1).max(CONTACT_MESSAGE_MAX),
  website: z.string().max(CONTACT_NAME_MAX).optional(),
});
