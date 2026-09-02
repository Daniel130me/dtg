/** Normalize an email exactly as the authentication persistence hook does. */
export function normalizeRegistrationEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The single-instructor account is provisioned out of band and must never be
 * recreated through the public student-registration flow.
 */
export function isReservedOwnerEmail(email: string, ownerEmail?: string): boolean {
  if (!ownerEmail) return false;
  return normalizeRegistrationEmail(email) === normalizeRegistrationEmail(ownerEmail);
}
