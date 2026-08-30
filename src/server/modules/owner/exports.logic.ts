import { EXPORT_TTL_HOURS, type ExportTypeValue } from "@/contracts/owner-ops";

// Pure CSV/export helpers: RFC4180 encoding, row mappers for the two export
// types, and the TTL/filename math. Everything here is deterministic and
// dependency-free so tests/unit/owner-ops.test.ts can pin the wire format —
// a silent change to these functions would change what owners download.

/**
 * Column headers per export type. Order is wire format: the row mappers below
 * emit cells in exactly this order, so the two must move together.
 */
export const ENROLMENT_EXPORT_HEADERS = [
  "enrolment_id",
  "learner_name",
  "learner_email",
  "course_title",
  "status",
  "source",
  "enrolled_at",
  "completed_at",
  "last_activity_at",
] as const;

export const STUDENT_EXPORT_HEADERS = [
  "user_id",
  "name",
  "email",
  "status",
  "created_at",
  "enrolment_count",
  "last_activity_at",
] as const;

/** DB-shaped input for one ENROLMENTS export row (dates still Date objects). */
export interface EnrolmentExportRow {
  id: string;
  userId: string;
  courseId: string;
  learnerName: string;
  learnerEmail: string;
  courseTitle: string;
  status: string;
  source: string;
  enrolledAt: Date;
  completedAt: Date | null;
  lastActivityAt: Date | null;
}

/** DB-shaped input for one STUDENTS export row. */
export interface StudentExportRow {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: Date;
  enrolmentCount: number;
  lastActivityAt: Date | null;
}

/** A cell needs RFC4180 quoting when it contains comma, quote, CR or LF. */
const CSV_SPECIAL_CHARS = /[",\r\n]/;

function escapeCsvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  // Quotes are doubled, then the whole field is wrapped in quotes (RFC4180 §2).
  return CSV_SPECIAL_CHARS.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toIsoCell(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Encodes a full CSV document: UTF-8 BOM prefix (so Excel detects the
 * encoding), records joined with CRLF line endings per RFC4180. The last
 * record intentionally carries no trailing CRLF — the document is exactly
 * "BOM + records joined by CRLF", which keeps the function trivially
 * assertable; spreadsheet tools accept both forms.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const records = [headers, ...rows].map((cells) => cells.map(escapeCsvCell).join(","));
  return `\uFEFF${records.join("\r\n")}`;
}

/**
 * Maps service rows to CSV cells for the ENROLMENTS export. Statuses and
 * sources stay as their raw enum labels: exports are data records, not
 * metrics (docs/ANALYTICS_METRICS.md "Exports"), so REVOKED rows are
 * labelled rather than filtered.
 */
export function enrolmentExportRows(
  rows: EnrolmentExportRow[],
): Array<Array<string | number | null>> {
  return rows.map((row) => [
    row.id,
    row.learnerName,
    row.learnerEmail,
    row.courseTitle,
    row.status,
    row.source,
    toIsoCell(row.enrolledAt),
    toIsoCell(row.completedAt),
    toIsoCell(row.lastActivityAt),
  ]);
}

/** Maps service rows to CSV cells for the STUDENTS export (same labelling). */
export function studentExportRows(
  rows: StudentExportRow[],
): Array<Array<string | number | null>> {
  return rows.map((row) => [
    row.id,
    row.name,
    row.email,
    row.status,
    toIsoCell(row.createdAt),
    row.enrolmentCount,
    toIsoCell(row.lastActivityAt),
  ]);
}

/**
 * Answers "is this job's file gone?". Only COMPLETED jobs can expire, by
 * comparison against their recorded `expiresAt` (boundary inclusive: a job
 * queried at exactly its expiry second is already expired). An EXPIRED row is
 * definitionally expired even though its `expiresAt` metadata survives the
 * content purge; any other status (PENDING/PROCESSING/FAILED) has no file to
 * expire, and a COMPLETED row without a recorded expiry never expires.
 */
export function isExportExpired(
  job: { status: string; expiresAt: Date | null },
  now: Date,
): boolean {
  if (job.status === "EXPIRED") return true;
  if (job.status !== "COMPLETED" || job.expiresAt === null) return false;
  return job.expiresAt.getTime() <= now.getTime();
}

/** TTL math: exports stop being downloadable EXPORT_TTL_HOURS after completion. */
export function exportExpiryFrom(completedAt: Date): Date {
  return new Date(completedAt.getTime() + EXPORT_TTL_HOURS * 60 * 60 * 1000);
}

/** Download filename: dtg-<type>-<yyyy-mm-dd>.csv, dated by completion. */
export function exportDownloadFilename(type: ExportTypeValue, completedAtIso: string): string {
  return `dtg-${type.toLowerCase()}-${completedAtIso.slice(0, 10)}.csv`;
}
