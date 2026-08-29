/**
 * Validates an untrusted `returnTo` query value and returns a safe in-app path,
 * or null when absent/unsafe so the caller can pick an appropriate fallback.
 */
export function safeRedirectPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "http://local.invalid");
    return url.origin === "http://local.invalid" ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}
