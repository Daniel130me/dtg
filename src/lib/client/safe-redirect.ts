const DEFAULT_REDIRECT = "/dashboard";

export function safeRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return DEFAULT_REDIRECT;
  try {
    const url = new URL(value, "http://local.invalid");
    return url.origin === "http://local.invalid" ? `${url.pathname}${url.search}${url.hash}` : DEFAULT_REDIRECT;
  } catch {
    return DEFAULT_REDIRECT;
  }
}
