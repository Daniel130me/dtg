import type { ApiFailure } from "@/contracts/api";
import type {
  AccountProfileDto,
  ChangeEmailInput,
  ChangePasswordInput,
  DeleteAccountInput,
  UpdateAccountProfileInput,
} from "@/contracts/accounts";
import { ApiClientError, apiRequest } from "@/lib/client/api-client";

const ACCOUNT_API_BASE = "/api/v1/account";

/** GET /api/v1/account/profile — profile, notification preferences, and stats. */
export function fetchAccountProfile(): Promise<AccountProfileDto> {
  return apiRequest<AccountProfileDto>(`${ACCOUNT_API_BASE}/profile`);
}

/**
 * PATCH /api/v1/account/profile — allowlisted update. Send only the fields
 * being changed; `null` clears bio/countryCode. The server responds with the
 * full refreshed profile, which callers should adopt as the source of truth.
 */
export function updateAccountProfile(
  input: UpdateAccountProfileInput,
): Promise<AccountProfileDto> {
  return apiRequest<AccountProfileDto>(`${ACCOUNT_API_BASE}/profile`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/**
 * POST /api/v1/account/password — rotate the password. Every OTHER session is
 * revoked (the caller's own session survives); `sessionsRevoked` tells the UI
 * how many devices were signed out.
 */
export function changeAccountPassword(
  input: ChangePasswordInput,
): Promise<{ sessionsRevoked: number }> {
  return apiRequest<{ sessionsRevoked: number }>(`${ACCOUNT_API_BASE}/password`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * POST /api/v1/account/email — change the email behind a current-password
 * check. The existing address stays active until the new one is verified.
 */
export function changeAccountEmail(
  input: ChangeEmailInput,
): Promise<{ verificationRequested: true }> {
  return apiRequest<{ verificationRequested: true }>(`${ACCOUNT_API_BASE}/email`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * POST /api/v1/account/delete — self-service deletion behind the typed
 * confirmation word. All sessions are revoked server-side and the session
 * cookie is cleared on the response; the caller should sign the client out
 * and navigate to the login page.
 */
export function deleteAccount(input: DeleteAccountInput): Promise<{ deleted: true }> {
  return apiRequest<{ deleted: true }>(`${ACCOUNT_API_BASE}/delete`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Extracts filename="..." from a Content-Disposition header, if present. */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return match ? match[1] : null;
}

/** dtg-account-export-<yyyy-mm-dd>.json — mirrors the server's naming. */
function fallbackExportFilename(): string {
  return `dtg-account-export-${new Date().toISOString().slice(0, 10)}.json`;
}

/**
 * GET /api/v1/account/export — triggers the personal-data archive download.
 * Raw fetch — apiRequest always parses JSON, which would break on the
 * attachment body (credentials are pinned explicitly, as in the owner export
 * download). Failure responses are the standard JSON ApiFailure envelope and
 * are rethrown as ApiClientError so the usual toast helpers can read them.
 */
export async function exportAccountData(): Promise<void> {
  const response = await fetch(`${ACCOUNT_API_BASE}/export`, {
    credentials: "same-origin",
    headers: { accept: "application/json, */*" },
  });

  if (!response.ok) {
    let code = "UNEXPECTED_RESPONSE";
    let message = "Your data export could not be downloaded.";
    let requestId: string | undefined;
    try {
      const payload = (await response.json()) as ApiFailure;
      if (payload?.error?.code) code = payload.error.code;
      if (payload?.error?.message) message = payload.error.message;
      requestId = payload?.error?.requestId;
    } catch {
      // Non-JSON failure body — the fallbacks above stand in.
    }
    throw new ApiClientError(response.status, code, message, requestId);
  }

  const disposition = response.headers.get("content-disposition");
  const filename = filenameFromDisposition(disposition) ?? fallbackExportFilename();

  // Blob -> object URL -> synthetic anchor click -> revoke. The download is
  // initiated synchronously by click(), so revoking right after is safe.
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
