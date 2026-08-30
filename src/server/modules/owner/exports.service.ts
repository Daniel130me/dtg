import { ExportJobStatus, ExportType, Prisma } from "@prisma/client";
import {
  EXPORT_EXPIRED,
  EXPORT_LIST_LIMIT,
  EXPORT_MAX_ROWS,
  EXPORT_NOT_FOUND,
  EXPORT_NOT_READY,
  type ExportCreateBody,
  type ExportJobDto,
  type ExportJobListDto,
} from "@/contracts/owner-ops";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import { decodeCursor, encodeCursor } from "@/server/http/pagination";
import { logger } from "@/server/observability/logger";
import {
  ENROLMENT_EXPORT_HEADERS,
  STUDENT_EXPORT_HEADERS,
  enrolmentExportRows,
  exportExpiryFrom,
  isExportExpired,
  studentExportRows,
  toCsv,
  type EnrolmentExportRow,
  type StudentExportRow,
} from "@/server/modules/owner/exports.logic";

// Authorization model: all three functions are reached only through
// requireOwner(headers). Every job query is additionally pinned to
// requestedByUserId = actor ("ownership-pinned findFirst" — another owner's
// export id reads as not-found), matching how learner certificates pin to
// their owner; at launch there is exactly one owner, but the scoping is the
// trust boundary if a second ever exists.
//
// Storage model (docs/ANALYTICS_METRICS.md "Exports"): there is no object
// storage in this environment, so the bounded CSV lives in the row and is
// streamed by the download endpoint. EXPIRED jobs keep their metadata but
// never their content — every expiry path purges the blob.
//
// Failure model: the job row IS the source of truth. A processing failure is
// recorded on the row (status FAILED + error) and reported to the caller as
// the job DTO with HTTP 200 — the UI renders the failure from the record;
// it is not an HTTP-level error.

/** Rows fetched per cursor page while filling the bounded buffer. */
const EXPORT_ITERATION_PAGE_SIZE = 500;
/** The ExportJob.error column is VarChar(500) — clamp messages to fit. */
const EXPORT_ERROR_MAX = 500;

const EXPORT_JOB_SELECT = {
  id: true,
  type: true,
  status: true,
  rowCount: true,
  error: true,
  expiresAt: true,
  completedAt: true,
  downloadCount: true,
  downloadedAt: true,
  createdAt: true,
} satisfies Prisma.ExportJobSelect;

type ExportJobRow = Prisma.ExportJobGetPayload<{ select: typeof EXPORT_JOB_SELECT }>;

function toExportJobDto(row: ExportJobRow): ExportJobDto {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    rowCount: row.rowCount,
    error: row.error,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    downloadCount: row.downloadCount,
    downloadedAt: row.downloadedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Newest-first (createdAt, id) keyset predicate for the export-iteration
 * cursors, house style: the same encoded { createdAt, id } cursor the lists
 * use. Returned as a plain AND clause so it composes with any model's where
 * input (the iteration pages over ExportJob-independent tables).
 */
function keysetAndClause(cursorValue: string) {
  const cursor = decodeCursor(cursorValue);
  const cursorDate = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: cursorDate } },
      { createdAt: cursorDate, id: { lt: cursor.id } },
    ],
  };
}

/**
 * Max completedAt per (userId, courseId) pair for one iteration page. The
 * where clause narrows by the page's distinct user/course ids (bounded by the
 * page size); a stray group outside the page's exact pairs is dropped by the
 * pair-key lookup, so correctness does not depend on the cross product.
 */
async function enrolmentLastActivityByPair(
  page: Array<{ userId: string; courseId: string }>,
): Promise<Map<string, Date | null>> {
  if (page.length === 0) return new Map();
  const groups = await db.lessonProgress.groupBy({
    by: ["userId", "courseId"],
    where: {
      userId: { in: [...new Set(page.map((row) => row.userId))] },
      courseId: { in: [...new Set(page.map((row) => row.courseId))] },
    },
    _max: { completedAt: true },
  });
  return new Map(
    groups.map((group) => [`${group.userId}:${group.courseId}`, group._max.completedAt]),
  );
}

// ---------------------------------------------------------------------------
// Row collection (cursor-bounded, capped at EXPORT_MAX_ROWS)
// ---------------------------------------------------------------------------

/**
 * TRUNCATION (documented per the brief): iteration stops at EXPORT_MAX_ROWS.
 * When more rows exist beyond the cap the file simply ends there and rowCount
 * records the capped count — an export is a bounded snapshot, not a
 * guaranteed-complete dump; that cap is what keeps the inline job (and the
 * CSV column) size-predictable. Order is newest first, so the cap keeps the
 * most recent rows.
 */
async function collectEnrolmentExportRows(): Promise<EnrolmentExportRow[]> {
  const rows: EnrolmentExportRow[] = [];
  let cursor: string | undefined;

  while (rows.length < EXPORT_MAX_ROWS) {
    const limit = Math.min(EXPORT_ITERATION_PAGE_SIZE, EXPORT_MAX_ROWS - rows.length);
    const where: Prisma.EnrolmentWhereInput = {};
    if (cursor) where.AND = [keysetAndClause(cursor)];

    const page = await db.enrolment.findMany({
      where,
      select: {
        id: true,
        userId: true,
        courseId: true,
        status: true,
        source: true,
        createdAt: true,
        completedAt: true,
        user: { select: { name: true, email: true } },
        course: { select: { title: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1, // peek: detect rows beyond the page without a count
    });
    const sawMore = page.length > limit;
    const usable = sawMore ? page.slice(0, limit) : page;
    if (usable.length === 0) return rows;

    const activity = await enrolmentLastActivityByPair(usable);
    for (const row of usable) {
      rows.push({
        id: row.id,
        userId: row.userId,
        courseId: row.courseId,
        learnerName: row.user.name,
        learnerEmail: row.user.email,
        courseTitle: row.course.title,
        status: row.status,
        source: row.source,
        enrolledAt: row.createdAt,
        completedAt: row.completedAt,
        lastActivityAt: activity.get(`${row.userId}:${row.courseId}`) ?? null,
      });
    }
    if (!sawMore) return rows;

    const last = usable.at(-1);
    if (!last) return rows;
    cursor = encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id });
  }
  return rows;
}

/** STUDENTS variant: learner pages plus two page-bounded aggregate reads. */
async function collectStudentExportRows(): Promise<StudentExportRow[]> {
  const rows: StudentExportRow[] = [];
  let cursor: string | undefined;

  while (rows.length < EXPORT_MAX_ROWS) {
    const limit = Math.min(EXPORT_ITERATION_PAGE_SIZE, EXPORT_MAX_ROWS - rows.length);
    const where: Prisma.UserWhereInput = {
      // Same learner scope as the student list: no OWNER role, no DELETED.
      role: { not: "OWNER" },
      status: { not: "DELETED" },
    };
    if (cursor) where.AND = [keysetAndClause(cursor)];

    const page = await db.user.findMany({
      where,
      select: { id: true, name: true, email: true, status: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const sawMore = page.length > limit;
    const usable = sawMore ? page.slice(0, limit) : page;
    if (usable.length === 0) return rows;

    const pageIds = usable.map((row) => row.id);
    const [enrolmentCounts, lastActivities] = await Promise.all([
      db.enrolment.groupBy({
        by: ["userId"],
        where: { userId: { in: pageIds } },
        _count: { _all: true },
      }),
      db.lessonProgress.groupBy({
        by: ["userId"],
        where: { userId: { in: pageIds } },
        _max: { completedAt: true },
      }),
    ]);
    const countByUser = new Map(enrolmentCounts.map((row) => [row.userId, row._count._all]));
    const activityByUser = new Map(
      lastActivities.map((row) => [row.userId, row._max.completedAt]),
    );

    for (const row of usable) {
      rows.push({
        id: row.id,
        name: row.name,
        email: row.email,
        status: row.status,
        createdAt: row.createdAt,
        enrolmentCount: countByUser.get(row.id) ?? 0,
        lastActivityAt: activityByUser.get(row.id) ?? null,
      });
    }
    if (!sawMore) return rows;

    const last = usable.at(-1);
    if (!last) return rows;
    cursor = encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id });
  }
  return rows;
}

/** A finished export file plus its data-row count (header excluded). */
interface BuiltExport {
  csv: string;
  rowCount: number;
}

/**
 * Builds the ENROLMENTS file. rowCount equals EXPORT_MAX_ROWS exactly when
 * truncation happened (see collectEnrolmentExportRows' TRUNCATION note).
 */
async function buildEnrolmentsCsv(): Promise<BuiltExport> {
  const cellRows = enrolmentExportRows(await collectEnrolmentExportRows());
  return {
    csv: toCsv([...ENROLMENT_EXPORT_HEADERS], cellRows),
    rowCount: cellRows.length,
  };
}

/** Builds the STUDENTS file (same bounded-iteration semantics). */
async function buildStudentsCsv(): Promise<BuiltExport> {
  const cellRows = studentExportRows(await collectStudentExportRows());
  return {
    csv: toCsv([...STUDENT_EXPORT_HEADERS], cellRows),
    rowCount: cellRows.length,
  };
}

// ---------------------------------------------------------------------------
// Create (POST /owner/exports) — job processed INLINE in the same request
// ---------------------------------------------------------------------------

/**
 * Creates an export job and processes it in the same request: PENDING →
 * PROCESSING (persisted honestly before the heavy reads) → cursor-bounded
 * row collection → CSV via the pure logic → COMPLETED in one transaction
 * with the expiry stamp and the "export.created" audit row.
 *
 * If the inline processing throws, the row is flipped to FAILED with the
 * clamped error message and the FAILED DTO is returned with HTTP 200 (the
 * record is the truth; the UI shows the failure). A best-effort
 * "export.failed" audit row keeps the privileged-mutation trail even for
 * failed attempts — a deliberate small extension of the brief's audit list.
 */
export async function createOwnerExport(
  actorId: string,
  body: ExportCreateBody,
  requestId: string,
): Promise<ExportJobDto> {
  const job = await db.exportJob.create({
    data: { requestedByUserId: actorId, type: body.type, status: ExportJobStatus.PENDING },
    select: EXPORT_JOB_SELECT,
  });

  try {
    // If this request dies mid-iteration the row must not linger as PENDING.
    await db.exportJob.update({
      where: { id: job.id },
      data: { status: ExportJobStatus.PROCESSING },
      select: { id: true },
    });

    const { csv, rowCount } =
      body.type === ExportType.ENROLMENTS ? await buildEnrolmentsCsv() : await buildStudentsCsv();
    const completedAt = new Date();

    const finished = await withTransaction(async (tx) => {
      const row = await tx.exportJob.update({
        where: { id: job.id },
        data: {
          status: ExportJobStatus.COMPLETED,
          content: csv,
          rowCount,
          completedAt,
          expiresAt: exportExpiryFrom(completedAt),
          error: null,
        },
        select: EXPORT_JOB_SELECT,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actorId,
          action: "export.created",
          entityType: "ExportJob",
          entityId: job.id,
          requestId,
          metadata: { type: body.type, rowCount },
        },
        select: { id: true },
      });
      return row;
    });

    return toExportJobDto(finished);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown export processing failure.";
    logger.error("Owner export processing failed", { exportJobId: job.id, error });
    try {
      const failed = await db.exportJob.update({
        where: { id: job.id },
        data: { status: ExportJobStatus.FAILED, error: message.slice(0, EXPORT_ERROR_MAX) },
        select: EXPORT_JOB_SELECT,
      });
      // Best effort: the FAILED DTO below is the contract; this audit must
      // never turn a recorded failure into a 500.
      await db.auditLog
        .create({
          data: {
            actorUserId: actorId,
            action: "export.failed",
            entityType: "ExportJob",
            entityId: job.id,
            requestId,
            metadata: { type: body.type },
          },
          select: { id: true },
        })
        .catch(() => undefined);
      return toExportJobDto(failed);
    } catch (recordError) {
      // Even the FAILED stamp failed — surface the original error so the
      // 500 carries the real cause, not the bookkeeping failure.
      logger.error("Owner export failure record could not be written", {
        exportJobId: job.id,
        recordError,
      });
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// List (GET /owner/exports)
// ---------------------------------------------------------------------------

/**
 * Owner export history, newest first, never carrying file content. Piggyback
 * expiry sweep first: no scheduler exists in this environment, so every
 * history read flips stale COMPLETED rows to EXPIRED and purges their blobs
 * (indexed by (status, expiresAt), platform-wide — expiry is TTL enforcement,
 * not privileged information).
 *
 * Query budget: 2 (sweep updateMany, page) — the sweep is a no-op write when
 * nothing is stale.
 */
export async function listOwnerExports(actorId: string): Promise<ExportJobListDto> {
  await db.exportJob.updateMany({
    where: { status: ExportJobStatus.COMPLETED, expiresAt: { lte: new Date() } },
    data: { status: ExportJobStatus.EXPIRED, content: null },
  });

  const jobs = await db.exportJob.findMany({
    // Ownership-pinned: the history is the requesting owner's jobs.
    where: { requestedByUserId: actorId },
    select: EXPORT_JOB_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: EXPORT_LIST_LIMIT,
  });

  return { items: jobs.map(toExportJobDto) };
}

// ---------------------------------------------------------------------------
// Download (GET /owner/exports/{exportJobId}/download)
// ---------------------------------------------------------------------------

export interface OwnerExportDownload {
  job: ExportJobDto;
  content: string;
}

/**
 * Streams one finished export. State machine on the job row:
 * - missing / not the caller's → 404 EXPORT_NOT_FOUND
 * - COMPLETED past TTL → flip to EXPIRED + purge content, then 410
 * - already EXPIRED → 410 EXPORT_EXPIRED
 * - PENDING / PROCESSING / FAILED → 409 EXPORT_NOT_READY
 * - COMPLETED and live → count the download, audit, return the content.
 *
 * The guarded updateMany is the race gate (mirrors certificate revoke):
 * between the read and the write another request could expire the job, and
 * only a still-COMPLETED row may count a download.
 */
export async function downloadOwnerExport(
  actorId: string,
  exportJobId: string,
  requestId: string,
): Promise<OwnerExportDownload> {
  const job = await db.exportJob.findFirst({
    where: { id: exportJobId, requestedByUserId: actorId },
    select: { ...EXPORT_JOB_SELECT, content: true },
  });
  if (!job) {
    throw new ApiError(404, EXPORT_NOT_FOUND, "The export job was not found.");
  }

  const now = new Date();
  if (isExportExpired(job, now)) {
    // First reader after the TTL does the flip + purge; repeats are no-ops.
    if (job.status === ExportJobStatus.COMPLETED) {
      await db.exportJob.updateMany({
        where: { id: job.id, status: ExportJobStatus.COMPLETED },
        data: { status: ExportJobStatus.EXPIRED, content: null },
      });
    }
    throw new ApiError(
      410,
      EXPORT_EXPIRED,
      "This export has expired and is no longer downloadable.",
    );
  }
  if (job.status !== ExportJobStatus.COMPLETED) {
    // No file exists yet (or the job failed) — the history DTO carries the
    // authoritative status/error for the UI.
    throw new ApiError(409, EXPORT_NOT_READY, "This export is not ready for download.");
  }
  if (job.content === null) {
    // Unreachable by construction (COMPLETED always stores content); refuse
    // rather than stream an empty file if the row was tampered with.
    throw new ApiError(409, EXPORT_NOT_READY, "This export is not ready for download.");
  }

  await withTransaction(async (tx) => {
    const counted = await tx.exportJob.updateMany({
      where: { id: job.id, status: ExportJobStatus.COMPLETED },
      data: { downloadCount: { increment: 1 }, downloadedAt: new Date() },
    });
    if (counted.count === 1) {
      await tx.auditLog.create({
        data: {
          actorUserId: actorId,
          action: "export.downloaded",
          entityType: "ExportJob",
          entityId: job.id,
          requestId,
          metadata: { type: job.type },
        },
        select: { id: true },
      });
    }
  });

  return { job: toExportJobDto(job), content: job.content };
}
