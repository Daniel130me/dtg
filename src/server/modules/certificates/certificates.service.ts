import { randomBytes } from "node:crypto";
import {
  CertificateStatus,
  CourseStatus,
  EnrolmentStatus,
  LessonStatus,
  LessonType,
  Prisma,
  QuizAttemptStatus,
  SubmissionStatus,
} from "@prisma/client";
import {
  CERTIFICATE_NOT_ELIGIBLE,
  CERTIFICATE_NOT_FOUND,
  CERTIFICATE_REVOKED,
  type CertificateDto,
  type MyCertificatesDto,
  type PublicCertificateDto,
} from "@/contracts/certificates";
import { db } from "@/server/db/client";
import { withTransaction } from "@/server/db/transaction";
import { ApiError } from "@/server/http/errors";
import {
  describeRevocationOutcome,
  describeUnmetRequirements,
  evaluateCertificateEligibility,
  generateCertificateCode,
  isUniqueConstraintViolation,
  normalizeCertificateCode,
  type CertificateEligibilityFacts,
} from "@/server/modules/certificates/certificates.logic";

// Authorization model: /api/v1/learning routes resolve the caller through
// requireAuthenticatedUser(headers) and every learner query is pinned to that
// user id (certificates additionally by ownership-pinned findFirst); the owner
// revoke route goes through requireOwner(headers); the public verify route has
// NO auth by design and returns the minimal public payload (never an email).

/** PlatformSettings row holding the brand name (single-row table). */
const PLATFORM_SETTINGS_ID = "platform";
/** Brand fallback when the settings row is missing (schema default is "DTG"). */
const DEFAULT_BRAND_NAME = "DTG";
/** learnerName of last resort; the User FK makes this effectively unreachable. */
const FALLBACK_LEARNER_NAME = "Learner";

// One select for every certificate read: the DTO needs the course slug/title
// and revoke's outbox payload needs the denormalized userId.
const CERTIFICATE_SELECT = {
  id: true,
  code: true,
  userId: true,
  courseId: true,
  status: true,
  issuedAt: true,
  revokedAt: true,
  course: { select: { slug: true, title: true } },
} satisfies Prisma.CertificateSelect;

type CertificateRow = Prisma.CertificateGetPayload<{ select: typeof CERTIFICATE_SELECT }>;

function toCertificateDto(row: CertificateRow): CertificateDto {
  return {
    id: row.id,
    code: row.code,
    courseId: row.courseId,
    courseSlug: row.course.slug,
    courseTitle: row.course.title,
    status: row.status,
    issuedAt: row.issuedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Eligibility read model (batched, shared by the single-course claim path and
// the learner's claim list so both run the SAME pure decision function)
// ---------------------------------------------------------------------------

/** Academic facts without the enrolment flag — callers decide that half. */
type AcademicFacts = Omit<CertificateEligibilityFacts, "hasActiveEnrolment">;

const EMPTY_ACADEMIC_FACTS: AcademicFacts = {
  publishedLessons: 0,
  completedLessons: 0,
  authoredQuizzes: 0,
  passedQuizzes: 0,
  authoredAssignments: 0,
  gradedAssignments: 0,
};

/**
 * Recomputes the academic eligibility facts for a set of courses IN one batch
 * of 5 queries regardless of course count (one course for the claim path, all
 * enrolled courses for the list). Callers only request courses the learner is
 * enrolled in, so the enrolment half of the facts is decided by the caller:
 * the claim path reads it from its course probe, the list path pre-filters to
 * ACTIVE/COMPLETED enrolment rows.
 *
 * Query budget per call: 5 (published-lesson counts, assessment-bearing
 * lessons, progress counts, passed-quiz groups, graded-submission groups).
 */
async function buildAcademicFactsByCourse(
  userId: string,
  courseIds: string[],
): Promise<Map<string, AcademicFacts>> {
  const factsByCourse = new Map<string, AcademicFacts>();
  if (courseIds.length === 0) return factsByCourse;

  const [publishedLessonCounts, assessmentLessons, progressCounts, passedQuizGroups, gradedSubmissionGroups] =
    await Promise.all([
      // (b) denominator: published lessons per course (drafts never gate).
      db.lesson.groupBy({
        by: ["courseId"],
        where: { courseId: { in: courseIds }, status: LessonStatus.PUBLISHED },
        _count: { _all: true },
      }),
      // (c)/(d) authored presence: a published QUIZ/ASSIGNMENT lesson only
      // gates when its assessment row actually exists.
      db.lesson.findMany({
        where: {
          courseId: { in: courseIds },
          status: LessonStatus.PUBLISHED,
          type: { in: [LessonType.QUIZ, LessonType.ASSIGNMENT] },
        },
        select: {
          courseId: true,
          type: true,
          quiz: { select: { id: true } },
          assignment: { select: { id: true } },
        },
      }),
      // (b) numerator: the learner's completion rows per course.
      db.lessonProgress.groupBy({
        by: ["courseId"],
        where: { userId, courseId: { in: courseIds } },
        _count: { _all: true },
      }),
      // (c) DISTINCT quizzes with >= 1 SUBMITTED+passed attempt: grouping by
      // (courseId, quizId) collapses repeated passes into one row per quiz.
      db.quizAttempt.groupBy({
        by: ["courseId", "quizId"],
        where: {
          userId,
          courseId: { in: courseIds },
          status: QuizAttemptStatus.SUBMITTED,
          passed: true,
          // A quiz whose lesson was later re-drafted stops gating both sides.
          quiz: { lesson: { status: LessonStatus.PUBLISHED, type: LessonType.QUIZ } },
        },
      }),
      // (d) DISTINCT assignments with >= 1 GRADED submission (any attempt).
      db.assignmentSubmission.groupBy({
        by: ["courseId", "assignmentId"],
        where: {
          userId,
          courseId: { in: courseIds },
          status: SubmissionStatus.GRADED,
          assignment: { lesson: { status: LessonStatus.PUBLISHED, type: LessonType.ASSIGNMENT } },
        },
      }),
    ]);

  const publishedByCourse = new Map(publishedLessonCounts.map((row) => [row.courseId, row._count._all]));
  const completedByCourse = new Map(progressCounts.map((row) => [row.courseId, row._count._all]));

  const authoredQuizzesByCourse = new Map<string, number>();
  const authoredAssignmentsByCourse = new Map<string, number>();
  for (const lesson of assessmentLessons) {
    // A lesson of the right type WITHOUT an authored row (quiz/assignment
    // null) is not counted — it must not gate the learner.
    if (lesson.type === LessonType.QUIZ && lesson.quiz) {
      authoredQuizzesByCourse.set(lesson.courseId, (authoredQuizzesByCourse.get(lesson.courseId) ?? 0) + 1);
    }
    if (lesson.type === LessonType.ASSIGNMENT && lesson.assignment) {
      authoredAssignmentsByCourse.set(lesson.courseId, (authoredAssignmentsByCourse.get(lesson.courseId) ?? 0) + 1);
    }
  }

  // Each (courseId, quizId/assignmentId) group row is one DISTINCT assessment.
  const passedByCourse = new Map<string, number>();
  for (const row of passedQuizGroups) {
    passedByCourse.set(row.courseId, (passedByCourse.get(row.courseId) ?? 0) + 1);
  }
  const gradedByCourse = new Map<string, number>();
  for (const row of gradedSubmissionGroups) {
    gradedByCourse.set(row.courseId, (gradedByCourse.get(row.courseId) ?? 0) + 1);
  }

  for (const courseId of courseIds) {
    factsByCourse.set(courseId, {
      publishedLessons: publishedByCourse.get(courseId) ?? 0,
      completedLessons: completedByCourse.get(courseId) ?? 0,
      authoredQuizzes: authoredQuizzesByCourse.get(courseId) ?? 0,
      passedQuizzes: passedByCourse.get(courseId) ?? 0,
      authoredAssignments: authoredAssignmentsByCourse.get(courseId) ?? 0,
      gradedAssignments: gradedByCourse.get(courseId) ?? 0,
    });
  }
  return factsByCourse;
}

// ---------------------------------------------------------------------------
// Learner list (GET /learning/certificates)
// ---------------------------------------------------------------------------

/**
 * The learner's issued certificates (newest first) plus the completed courses
 * still worth claiming, computed with the same batched facts as the claim path
 * and excluding courses that already have a certificate in ANY status (a
 * REVOKED certificate must not reappear as claimable).
 *
 * Query budget: 7 (enrolments, certificates, 5 batched fact queries).
 */
export async function getMyCertificates(userId: string): Promise<MyCertificatesDto> {
  const [enrolments, certificates] = await Promise.all([
    db.enrolment.findMany({
      // Only an enrolment the learner still holds (ACTIVE/COMPLETED) on a
      // published course can mint a certificate.
      where: {
        userId,
        status: { in: [EnrolmentStatus.ACTIVE, EnrolmentStatus.COMPLETED] },
        course: { status: CourseStatus.PUBLISHED },
      },
      select: { courseId: true, course: { select: { id: true, slug: true, title: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.certificate.findMany({
      where: { userId },
      select: CERTIFICATE_SELECT,
      orderBy: { issuedAt: "desc" },
    }),
  ]);

  const courseIds = enrolments.map((enrolment) => enrolment.courseId);
  const factsByCourse = await buildAcademicFactsByCourse(userId, courseIds);
  const certifiedCourseIds = new Set(certificates.map((certificate) => certificate.courseId));

  const eligibleCourses: MyCertificatesDto["eligibleCourses"] = [];
  for (const enrolment of enrolments) {
    if (certifiedCourseIds.has(enrolment.courseId)) continue;
    const facts = factsByCourse.get(enrolment.courseId);
    if (!facts) continue;
    // Every listed course came from an ACTIVE/COMPLETED enrolment row.
    const decision = evaluateCertificateEligibility({ ...facts, hasActiveEnrolment: true });
    if (!decision.eligible) continue;
    eligibleCourses.push({
      courseId: enrolment.courseId,
      slug: enrolment.course.slug,
      title: enrolment.course.title,
    });
  }

  return { certificates: certificates.map(toCertificateDto), eligibleCourses };
}

// ---------------------------------------------------------------------------
// Issue (POST /learning/courses/{slug}/certificate)
// ---------------------------------------------------------------------------

/**
 * Idempotent certificate claim for a published course.
 *
 * Query budget: 7 reads (course+enrolment probe, certificate fast path, 5
 * batched fact queries) + tx { create, audit, outbox }.
 */
export async function issueCertificate(
  userId: string,
  slug: string,
  requestId: string,
): Promise<CertificateDto> {
  // Course + the caller's enrolment status in ONE query (the enrolment-state
  // probe pattern from enrolments.service).
  const course = await db.course.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      enrolments: { where: { userId }, select: { status: true }, take: 1 },
    },
  });
  // Mirrors the catalog: draft/archived courses do not exist for learners.
  if (!course || course.status !== CourseStatus.PUBLISHED) {
    throw new ApiError(404, "COURSE_NOT_FOUND", "The requested course does not exist or is not published.");
  }
  const enrolmentStatus = course.enrolments[0]?.status ?? null;
  const hasActiveEnrolment =
    enrolmentStatus === EnrolmentStatus.ACTIVE || enrolmentStatus === EnrolmentStatus.COMPLETED;

  // Idempotency fast path: claiming twice returns the existing certificate
  // (any status) without recomputing eligibility or duplicating audit/outbox.
  const existing = await db.certificate.findUnique({
    where: { userId_courseId: { userId, courseId: course.id } },
    select: CERTIFICATE_SELECT,
  });
  if (existing) return toCertificateDto(existing);

  // Canonical eligibility, recomputed live — see certificates.logic.
  const facts = (await buildAcademicFactsByCourse(userId, [course.id])).get(course.id) ?? EMPTY_ACADEMIC_FACTS;
  const decision = evaluateCertificateEligibility({ ...facts, hasActiveEnrolment });
  if (!decision.eligible) {
    throw new ApiError(
      422,
      CERTIFICATE_NOT_ELIGIBLE,
      `Certificate requirements are not met yet: ${describeUnmetRequirements(decision.unmetReasons)}.`,
    );
  }

  // ~80-bit Crockford-style code from crypto.randomBytes; the generator is
  // injected into the pure logic so tests can exercise format/uniqueness.
  const code = generateCertificateCode((length) => randomBytes(length));

  try {
    return await withTransaction(async (tx) => {
      const created = await tx.certificate.create({
        data: { code, userId, courseId: course.id, status: CertificateStatus.ACTIVE },
        select: CERTIFICATE_SELECT,
      });
      // Audit + outbox fire on the issuing request only; a request that loses
      // the insert race below returns the winner, whose own transaction
      // already wrote both — exactly-once by construction.
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: "certificate.issued",
          entityType: "Certificate",
          entityId: created.id,
          requestId,
          metadata: { courseId: course.id, code },
        },
        select: { id: true },
      });
      await tx.outboxEvent.create({
        data: {
          eventKey: `certificate.issued:${created.id}`,
          topic: "certificate.issued",
          aggregateType: "Certificate",
          aggregateId: created.id,
          payload: { certificateId: created.id, userId, courseId: course.id, code },
        },
        select: { id: true },
      });
      return toCertificateDto(created);
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      // Lost a (userId, courseId) insert race: fall back to the winning row so
      // the request stays idempotent (200, not 409).
      const winner = await db.certificate.findUnique({
        where: { userId_courseId: { userId, courseId: course.id } },
        select: CERTIFICATE_SELECT,
      });
      if (winner) return toCertificateDto(winner);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Download (GET /learning/certificates/{certificateId}/download)
// ---------------------------------------------------------------------------

/** Everything the PDF renderer needs, resolved by the service. */
export interface CertificateDownloadData {
  code: string;
  learnerName: string;
  courseTitle: string;
  brandName: string;
  issuedAt: Date;
}

/**
 * Ownership-pinned certificate lookup for the PDF download.
 *
 * Query budget: 3 (certificate, user+profile, platform settings).
 */
export async function getMyCertificateDownload(
  userId: string,
  certificateId: string,
): Promise<CertificateDownloadData> {
  const certificate = await db.certificate.findFirst({
    // Ownership-pinned: another learner's certificate id reads as not-found.
    where: { id: certificateId, userId },
    select: {
      code: true,
      status: true,
      issuedAt: true,
      course: { select: { title: true } },
    },
  });
  if (!certificate) {
    throw new ApiError(404, CERTIFICATE_NOT_FOUND, "The certificate was not found.");
  }
  if (certificate.status === CertificateStatus.REVOKED) {
    throw new ApiError(422, CERTIFICATE_REVOKED, "This certificate has been revoked.");
  }

  const [user, settings] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { name: true, profile: { select: { displayName: true } } },
    }),
    db.platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
      select: { brandName: true },
    }),
  ]);

  return {
    code: certificate.code,
    // Display name first, account name as fallback — never an email.
    learnerName: user?.profile?.displayName ?? user?.name ?? FALLBACK_LEARNER_NAME,
    courseTitle: certificate.course.title,
    brandName: settings?.brandName ?? DEFAULT_BRAND_NAME,
    issuedAt: certificate.issuedAt,
  };
}

// ---------------------------------------------------------------------------
// Owner revoke (POST /owner/certificates/{certificateId}/revoke)
// ---------------------------------------------------------------------------

/**
 * Idempotent revocation: revoking an already-REVOKED certificate returns its
 * current state without a second audit/outbox pair (the pure decision lives in
 * certificates.logic). The guarded updateMany is the race gate — only the
 * request that flips ACTIVE -> REVOKED writes the side effects, mirroring the
 * enrolment completion flip in progress.service.
 *
 * Query budget: 2 reads (before, after) + tx { updateMany, optional audit +
 * outbox }.
 */
export async function revokeCertificate(
  actorOwnerId: string,
  certificateId: string,
  reason: string,
  requestId: string,
): Promise<CertificateDto> {
  const certificate = await db.certificate.findUnique({
    where: { id: certificateId },
    select: CERTIFICATE_SELECT,
  });
  if (!certificate) {
    throw new ApiError(404, CERTIFICATE_NOT_FOUND, "The certificate was not found.");
  }
  if (describeRevocationOutcome(certificate.status) === "ALREADY_REVOKED") {
    return toCertificateDto(certificate);
  }

  const revokedAt = new Date();
  await withTransaction(async (tx) => {
    const flipped = await tx.certificate.updateMany({
      where: { id: certificate.id, status: CertificateStatus.ACTIVE },
      data: { status: CertificateStatus.REVOKED, revokedAt, revokedReason: reason },
    });
    if (flipped.count === 1) {
      await tx.outboxEvent.create({
        data: {
          eventKey: `certificate.revoked:${certificate.id}`,
          topic: "certificate.revoked",
          aggregateType: "Certificate",
          aggregateId: certificate.id,
          payload: {
            certificateId: certificate.id,
            userId: certificate.userId,
            courseId: certificate.courseId,
            reason,
            revokedAt: revokedAt.toISOString(),
          },
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actorOwnerId,
          action: "certificate.revoked",
          entityType: "Certificate",
          entityId: certificate.id,
          requestId,
          metadata: { reason },
        },
        select: { id: true },
      });
    }
  });

  // Re-read with the full select so the response carries the join + new status.
  const updated = await db.certificate.findUnique({
    where: { id: certificate.id },
    select: CERTIFICATE_SELECT,
  });
  if (!updated) {
    throw new ApiError(404, CERTIFICATE_NOT_FOUND, "The certificate was not found.");
  }
  return toCertificateDto(updated);
}

// ---------------------------------------------------------------------------
// Public verify (GET /certificates/{code}) — NO auth by design
// ---------------------------------------------------------------------------

/**
 * Minimal public verification payload: existence, status (a REVOKED
 * certificate verifies honestly as revoked), the learner's display name and
 * the course title — never an email.
 *
 * Query budget: 2 (certificate, platform settings).
 */
export async function verifyPublicCertificate(rawCode: string): Promise<PublicCertificateDto> {
  // Codes are stored uppercase (generateCertificateCode only emits uppercase);
  // normalization lets a padded or hand-typed lowercase code still verify.
  const code = normalizeCertificateCode(rawCode);
  const [certificate, settings] = await Promise.all([
    db.certificate.findUnique({
      where: { code },
      select: {
        code: true,
        status: true,
        issuedAt: true,
        course: { select: { title: true } },
        user: { select: { name: true, profile: { select: { displayName: true } } } },
      },
    }),
    db.platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
      select: { brandName: true },
    }),
  ]);
  // A miss reveals nothing beyond absence: the same 404 for any unknown code.
  if (!certificate) {
    throw new ApiError(404, CERTIFICATE_NOT_FOUND, "No certificate carries this code.");
  }
  return {
    code: certificate.code,
    status: certificate.status,
    issuedAt: certificate.issuedAt.toISOString(),
    learnerName: certificate.user.profile?.displayName ?? certificate.user.name,
    courseTitle: certificate.course.title,
    brandName: settings?.brandName ?? DEFAULT_BRAND_NAME,
  };
}
