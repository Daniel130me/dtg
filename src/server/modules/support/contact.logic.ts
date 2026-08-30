import { CONTACT_HONEYPOT_FIELD, CONTACT_MAX_LINKS } from "@/contracts/support";

// ---------------------------------------------------------------------------
// Pure support-contact policy: spam assessment and retention date math.
// No database, no transport — unit-testable by design.
// ---------------------------------------------------------------------------

/** The spec's link heuristic: count protocol occurrences in the message. */
const URL_PATTERN = /https?:\/\//gi;

/**
 * Spam policy (deliberately opaque to the caller — the response copy never
 * reveals which control tripped):
 *  1. Honeypot: the public form renders the `website` field hidden and empty;
 *     any non-empty value is a bot (humans cannot see the field).
 *  2. Link count: more than CONTACT_MAX_LINKS protocol occurrences in the
 *     message body is characteristic of link spam.
 */
export function assessContactSpam(input: { website?: string; message: string }): boolean {
  const honeypot = input[CONTACT_HONEYPOT_FIELD];
  if (honeypot !== undefined && honeypot.trim().length > 0) return true;

  const linkCount = input.message.match(URL_PATTERN)?.length ?? 0;
  return linkCount > CONTACT_MAX_LINKS;
}

/** Retention cutoff: submissions created before this instant are purgeable. */
export function contactRetentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
