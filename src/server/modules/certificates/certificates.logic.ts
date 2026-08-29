// Pure, DB-free certificate rules so they stay unit-testable without a
// database. The service owns the queries; this module owns every decision
// worth testing (eligibility matrix, code generation/format, code
// normalization, idempotent-issue and revocation decisions).

import { CERTIFICATE_CODE_LENGTH } from "@/contracts/certificates";

// ---------------------------------------------------------------------------
// Canonical eligibility policy
// ---------------------------------------------------------------------------

/** Stable machine-readable reasons why a certificate claim was refused. */
export type CertificateUnmetReason =
  | "ENROLMENT_REQUIRED"
  | "LESSONS_INCOMPLETE"
  | "QUIZ_NOT_PASSED"
  | "ASSIGNMENT_NOT_GRADED";

/**
 * Per-course facts feeding the eligibility decision. The service recomputes
 * every fact live (progress rows, attempts, submissions) — the denormalized
 * enrolment.status may predate quizzes and is never trusted.
 */
export interface CertificateEligibilityFacts {
  /** An enrolment row exists and is ACTIVE or COMPLETED (never REVOKED). */
  hasActiveEnrolment: boolean;
  /** Published lessons of the course (drafts never gate a learner). */
  publishedLessons: number;
  /** The learner's LessonProgress rows for the course. */
  completedLessons: number;
  /** Quizzes authored on PUBLISHED QUIZ lessons. */
  authoredQuizzes: number;
  /** DISTINCT quizzes with >= 1 SUBMITTED attempt that passed. */
  passedQuizzes: number;
  /** Assignments authored on PUBLISHED ASSIGNMENT lessons. */
  authoredAssignments: number;
  /** DISTINCT assignments with >= 1 GRADED submission (any attempt). */
  gradedAssignments: number;
}

export interface CertificateEligibilityDecision {
  eligible: boolean;
  unmetReasons: CertificateUnmetReason[];
}

/**
 * Canonical certificate eligibility (documented in worklog Task 13-foundation):
 * a learner is eligible for a published course when
 *   (a) an ACTIVE/COMPLETED enrolment exists;
 *   (b) ALL published lessons are completed (recomputed live);
 *   (c) EVERY authored quiz on a published QUIZ lesson has a passed attempt;
 *   (d) EVERY authored assignment on a published ASSIGNMENT lesson has a
 *       GRADED submission.
 * Only lessons WITH an authored assessment gate: a QUIZ lesson without a quiz
 * (or an ASSIGNMENT lesson without an assignment) contributes zero to the
 * authored counts, so it cannot block. A course with zero published lessons is
 * vacuously complete — curriculum shape is owner-controlled, not a learner-side
 * trust concern.
 */
export function evaluateCertificateEligibility(
  facts: CertificateEligibilityFacts,
): CertificateEligibilityDecision {
  const unmetReasons: CertificateUnmetReason[] = [];
  if (!facts.hasActiveEnrolment) unmetReasons.push("ENROLMENT_REQUIRED");
  if (facts.completedLessons < facts.publishedLessons) unmetReasons.push("LESSONS_INCOMPLETE");
  if (facts.passedQuizzes < facts.authoredQuizzes) unmetReasons.push("QUIZ_NOT_PASSED");
  if (facts.gradedAssignments < facts.authoredAssignments) unmetReasons.push("ASSIGNMENT_NOT_GRADED");
  return { eligible: unmetReasons.length === 0, unmetReasons };
}

/** Human sentence fragments for the 422 message listing unmet requirements. */
const UNMET_REASON_TEXT: Record<CertificateUnmetReason, string> = {
  ENROLMENT_REQUIRED: "enroll in the course",
  LESSONS_INCOMPLETE: "complete all published lessons",
  QUIZ_NOT_PASSED: "pass every course quiz",
  ASSIGNMENT_NOT_GRADED: "submit every course assignment and have it graded",
};

/** Joins the unmet reasons into one learner-facing sentence fragment. */
export function describeUnmetRequirements(reasons: readonly CertificateUnmetReason[]): string {
  return reasons.map((reason) => UNMET_REASON_TEXT[reason]).join("; ");
}

// ---------------------------------------------------------------------------
// Verification codes
// ---------------------------------------------------------------------------

/**
 * Crockford-style base32: digits plus uppercase letters minus I/L/O/U so a
 * hand-typed code has no visually confusable characters. Exactly 32 symbols,
 * and 32 divides 256, so byte % 32 maps randomness without modulo bias.
 */
export const CERTIFICATE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Injected randomness source (crypto.randomBytes in the service). */
export type RandomBytesFactory = (length: number) => Uint8Array;

/**
 * High-entropy verification code: `length` symbols drawn from the Crockford
 * alphabet, one per random byte (~5 bits of entropy each; 16 chars = ~80 bits
 * — unguessable, and collisions are negligible for a unique column).
 */
export function generateCertificateCode(
  randomBytes: RandomBytesFactory,
  length: number = CERTIFICATE_CODE_LENGTH,
): string {
  const bytes = randomBytes(length);
  if (bytes.length !== length) {
    throw new Error("The random byte factory returned the wrong number of bytes.");
  }
  let code = "";
  for (const byte of bytes) {
    code += CERTIFICATE_CODE_ALPHABET[byte % CERTIFICATE_CODE_ALPHABET.length];
  }
  return code;
}

/** Codes are stored uppercase and without padding; normalize before lookup. */
export function normalizeCertificateCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Format validation of an (already normalized) verification code. */
export function isValidCertificateCode(code: string): boolean {
  if (code.length !== CERTIFICATE_CODE_LENGTH) return false;
  for (const char of code) {
    if (!CERTIFICATE_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Idempotency decisions
// ---------------------------------------------------------------------------

/**
 * True when the error is Prisma's unique-violation (P2002). Duck-typed on
 * `error.code` so the decision stays testable without importing the client.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Revocation is idempotent: an already-REVOKED certificate returns its current
 * state without writing a second audit/outbox pair.
 */
export function describeRevocationOutcome(status: string): "REVOKE" | "ALREADY_REVOKED" {
  return status === "REVOKED" ? "ALREADY_REVOKED" : "REVOKE";
}
