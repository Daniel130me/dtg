import { ApiClientError, apiRequest } from "@/lib/client/api-client";
import type { ApiFailure } from "@/contracts/api";
import type { z } from "zod";
import type { OwnerAnalyticsDto } from "@/contracts/analytics";
import type {
  ContactStatusValue,
  ExportJobDto,
  ExportJobListDto,
  ExportTypeValue,
  ManageableUserStatus,
  OwnerContactRowDto,
  OwnerStudentDetailDto,
  OwnerUserStatusResult,
  PaginatedOwnerAuditDto,
  PaginatedOwnerContactsDto,
  PaginatedOwnerStudentsDto,
  ownerAuditQuerySchema,
  ownerContactListQuerySchema,
  ownerStudentListQuerySchema,
} from "@/contracts/owner-ops";

// Typed client for the Phase 11 owner analytics + administration APIs.
// Route paths and verbs mirror the handlers under src/app/api/v1/owner/
// (all of them require the OWNER role — the browser session cookie is
// attached automatically by apiRequest). The one exception is the export
// download: it answers with a raw text/csv attachment instead of the JSON
// envelope, so it is fetched manually below and turned into a browser
// download on the client.

const OWNER_API_BASE = "/api/v1/owner";

// Query inputs use z.input (pre-default) so callers can omit optional
// fields; the server re-parses and applies its own defaults. Mirrors the
// z.input pattern in features/engagement/api.ts.
export type OwnerStudentListInput = z.input<typeof ownerStudentListQuerySchema>;
export type OwnerContactListInput = z.input<typeof ownerContactListQuerySchema>;
export type OwnerAuditListInput = z.input<typeof ownerAuditQuerySchema>;

/** Serializes a query object to a query string, skipping empty values. */
function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

// -------------------------------------------------------------------------
// Analytics read model
// -------------------------------------------------------------------------

/** GET /owner/analytics — the cached dashboard payload (60s TTL server-side). */
export function getOwnerAnalytics(): Promise<OwnerAnalyticsDto> {
  return apiRequest<OwnerAnalyticsDto>(`${OWNER_API_BASE}/analytics`);
}

// -------------------------------------------------------------------------
// Student management
// -------------------------------------------------------------------------

/** GET /owner/students?q=&status=&cursor=&limit= — learner directory page. */
export function listOwnerStudents(
  query: OwnerStudentListInput = {},
): Promise<PaginatedOwnerStudentsDto> {
  return apiRequest<PaginatedOwnerStudentsDto>(
    `${OWNER_API_BASE}/students${buildQueryString(query)}`,
  );
}

/** GET /owner/students/{userId} — one learner with enrolment detail. */
export function getOwnerStudent(userId: string): Promise<OwnerStudentDetailDto> {
  return apiRequest<OwnerStudentDetailDto>(
    `${OWNER_API_BASE}/students/${encodeURIComponent(userId)}`,
  );
}

/**
 * POST /owner/users/{userId}/status — ACTIVE ⇄ SUSPENDED. Suspending
 * revokes the target's sessions; the result reports how many.
 */
export function setOwnerUserStatus(
  userId: string,
  status: ManageableUserStatus,
): Promise<OwnerUserStatusResult> {
  return apiRequest<OwnerUserStatusResult>(
    `${OWNER_API_BASE}/users/${encodeURIComponent(userId)}/status`,
    { method: "POST", body: JSON.stringify({ status }) },
  );
}

// -------------------------------------------------------------------------
// Support inbox + audit (wrapper-only for now; the inbox UI is a follow-up)
// -------------------------------------------------------------------------

/** GET /owner/support/contact?status=&cursor=&limit= — triage inbox page. */
export function listOwnerContacts(
  query: OwnerContactListInput = {},
): Promise<PaginatedOwnerContactsDto> {
  return apiRequest<PaginatedOwnerContactsDto>(
    `${OWNER_API_BASE}/support/contact${buildQueryString(query)}`,
  );
}

/** PATCH /owner/support/contact/{submissionId} — NEW ⇄ ARCHIVED. */
export function setOwnerContactStatus(
  submissionId: string,
  status: ContactStatusValue,
): Promise<OwnerContactRowDto> {
  return apiRequest<OwnerContactRowDto>(
    `${OWNER_API_BASE}/support/contact/${encodeURIComponent(submissionId)}`,
    { method: "PATCH", body: JSON.stringify({ status }) },
  );
}

/** GET /owner/audit?actorId=&action=&cursor=&limit= — audit trail page. */
export function listOwnerAudit(query: OwnerAuditListInput = {}): Promise<PaginatedOwnerAuditDto> {
  return apiRequest<PaginatedOwnerAuditDto>(`${OWNER_API_BASE}/audit${buildQueryString(query)}`);
}

// -------------------------------------------------------------------------
// Exports
// -------------------------------------------------------------------------

/**
 * POST /owner/exports — creates a job AND processes it inline; the returned
 * DTO is the finished job (COMPLETED, or FAILED with its error recorded on
 * the row — a FAILED job arrives with HTTP 200, the record is the truth).
 */
export function createOwnerExport(type: ExportTypeValue): Promise<ExportJobDto> {
  return apiRequest<ExportJobDto>(`${OWNER_API_BASE}/exports`, {
    method: "POST",
    body: JSON.stringify({ type }),
  });
}

/** GET /owner/exports — the requesting owner's job history, newest first. */
export function listOwnerExports(): Promise<ExportJobListDto> {
  return apiRequest<ExportJobListDto>(`${OWNER_API_BASE}/exports`);
}

/** Extracts filename="..." from a Content-Disposition header, if present. */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return match ? match[1] : null;
}

/** dtg-<type>-<yyyy-mm-dd>.csv — mirrors the server's exportDownloadFilename. */
function fallbackExportFilename(job: ExportJobDto): string {
  const dateStamp = (job.completedAt ?? job.createdAt).slice(0, 10);
  return `dtg-${job.type.toLowerCase()}-${dateStamp}.csv`;
}

/**
 * Downloads one finished export as a CSV file. Raw fetch — apiRequest always
 * parses JSON, which would break on the CSV body (credentials are the
 * same-origin default for a relative URL, but they are pinned explicitly).
 *
 * Failure responses are the standard JSON ApiFailure envelope (410
 * EXPORT_EXPIRED, 409 EXPORT_NOT_READY, 404 EXPORT_NOT_FOUND) and are
 * rethrown as ApiClientError so callers can branch on error.code and the
 * usual toast helpers can read status/message.
 */
export async function downloadOwnerExportCsv(job: ExportJobDto): Promise<void> {
  const response = await fetch(
    `${OWNER_API_BASE}/exports/${encodeURIComponent(job.id)}/download`,
    { credentials: "same-origin", headers: { accept: "text/csv, application/json;q=0.9, */*;q=0.8" } },
  );

  if (!response.ok) {
    let code = "UNEXPECTED_RESPONSE";
    let message = "The export file could not be downloaded.";
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
  const filename = filenameFromDisposition(disposition) ?? fallbackExportFilename(job);

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

// -------------------------------------------------------------------------
// Edge formatting (kept here, not in lib/client/format.ts, because the
// analytics surfaces need revenue semantics formatPrice cannot express:
// 0 is a real amount there, never "Free", and net revenue may be negative)
// -------------------------------------------------------------------------

/** Minor units -> major units for chart axes (250_000 -> 2500). */
export function minorToMajor(amountMinor: number): number {
  return amountMinor / 100;
}

/** Revenue money formatting: negative net formats with a minus sign. */
export function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(major);
  } catch {
    // Unknown currency codes fall back to a symbol-less amount.
    const sign = major < 0 ? "-" : "";
    return `${sign}${Math.abs(major).toFixed(2)} ${currency}`;
  }
}

/** Compact axis money for chart ticks: "$12.5K" / "$480" / "$12.40". */
export function formatAxisMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  try {
    if (Math.abs(major) >= 1000) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(major);
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    }).format(major);
  } catch {
    return formatMoney(amountMinor, currency);
  }
}
