import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  certificateRevokeSchema,
  certificateCodeParamSchema,
  CERTIFICATE_CODE_LENGTH,
  myCertificatesSchema,
  publicCertificateSchema,
} from "@/contracts/certificates";
import {
  CERTIFICATE_CODE_ALPHABET,
  describeRevocationOutcome,
  describeUnmetRequirements,
  evaluateCertificateEligibility,
  generateCertificateCode,
  isUniqueConstraintViolation,
  isValidCertificateCode,
  normalizeCertificateCode,
  type CertificateEligibilityFacts,
  type RandomBytesFactory,
} from "@/server/modules/certificates/certificates.logic";

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/** Facts for a learner who met every requirement of a small course. */
const eligibleFacts: CertificateEligibilityFacts = {
  hasActiveEnrolment: true,
  publishedLessons: 5,
  completedLessons: 5,
  authoredQuizzes: 1,
  passedQuizzes: 1,
  authoredAssignments: 1,
  gradedAssignments: 1,
};

/** Deterministic fake randomness: byte i = (seed + i*37) % 256. */
function fakeRandomBytes(seed: number): RandomBytesFactory {
  return (length: number) => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = (seed + i * 37) % 256;
    return bytes;
  };
}

function constantRandomBytes(byte: number): RandomBytesFactory {
  return (length: number) => new Uint8Array(length).fill(byte);
}

describe("certificate eligibility matrix", () => {
  it("is eligible when lessons are complete, quizzes passed and assignments graded", () => {
    const decision = evaluateCertificateEligibility(eligibleFacts);
    assert.equal(decision.eligible, true);
    assert.deepEqual(decision.unmetReasons, []);
  });

  it("requires an enrolment that is not REVOKED", () => {
    const decision = evaluateCertificateEligibility({ ...eligibleFacts, hasActiveEnrolment: false });
    assert.equal(decision.eligible, false);
    assert.deepEqual(decision.unmetReasons, ["ENROLMENT_REQUIRED"]);
  });

  it("reports incomplete lessons when a published lesson is not completed", () => {
    const decision = evaluateCertificateEligibility({ ...eligibleFacts, completedLessons: 4 });
    assert.deepEqual(decision.unmetReasons, ["LESSONS_INCOMPLETE"]);
  });

  it("gates on every authored quiz having a passed attempt", () => {
    const decision = evaluateCertificateEligibility({ ...eligibleFacts, passedQuizzes: 0 });
    assert.deepEqual(decision.unmetReasons, ["QUIZ_NOT_PASSED"]);
  });

  it("gates on every authored assignment having a graded submission", () => {
    const decision = evaluateCertificateEligibility({ ...eligibleFacts, gradedAssignments: 0 });
    assert.deepEqual(decision.unmetReasons, ["ASSIGNMENT_NOT_GRADED"]);
  });

  it("does not gate a QUIZ lesson without an authored quiz", () => {
    const decision = evaluateCertificateEligibility({ ...eligibleFacts, authoredQuizzes: 0, passedQuizzes: 0 });
    assert.equal(decision.eligible, true);
  });

  it("does not gate an ASSIGNMENT lesson without an authored assignment", () => {
    const decision = evaluateCertificateEligibility({
      ...eligibleFacts,
      authoredAssignments: 0,
      gradedAssignments: 0,
    });
    assert.equal(decision.eligible, true);
  });

  it("ignores stale completion rows for lessons that were re-drafted", () => {
    // completed > published: progress rows for re-drafted lessons must never
    // break eligibility (the live count is the published denominator).
    const decision = evaluateCertificateEligibility({ ...eligibleFacts, completedLessons: 7 });
    assert.equal(decision.eligible, true);
  });

  it("collects every unmet reason at once", () => {
    const decision = evaluateCertificateEligibility({
      hasActiveEnrolment: false,
      publishedLessons: 5,
      completedLessons: 2,
      authoredQuizzes: 2,
      passedQuizzes: 1,
      authoredAssignments: 1,
      gradedAssignments: 0,
    });
    assert.deepEqual(decision.unmetReasons, [
      "ENROLMENT_REQUIRED",
      "LESSONS_INCOMPLETE",
      "QUIZ_NOT_PASSED",
      "ASSIGNMENT_NOT_GRADED",
    ]);
  });

  it("renders a human message for the unmet reasons", () => {
    const message = describeUnmetRequirements(["LESSONS_INCOMPLETE", "QUIZ_NOT_PASSED"]);
    assert.ok(message.includes("complete all published lessons"));
    assert.ok(message.includes("pass every course quiz"));
    assert.ok(!message.includes("enroll"));
    assert.equal(describeUnmetRequirements([]), "");
  });
});

describe("verification code generation", () => {
  it("renders exactly 16 uppercase characters from the Crockford alphabet", () => {
    const code = generateCertificateCode(fakeRandomBytes(7));
    assert.equal(code.length, CERTIFICATE_CODE_LENGTH);
    for (const char of code) {
      assert.ok(CERTIFICATE_CODE_ALPHABET.includes(char), `unexpected char ${char}`);
      assert.equal(char, char.toUpperCase());
    }
  });

  it("maps the full byte range without bias onto the alphabet", () => {
    assert.equal(generateCertificateCode(constantRandomBytes(0x00)), "0".repeat(16));
    assert.equal(generateCertificateCode(constantRandomBytes(0xff)), "Z".repeat(16));
  });

  it("throws when the injected factory returns the wrong length", () => {
    assert.throws(() => generateCertificateCode((length) => new Uint8Array(length - 1)));
  });

  it("produces distinct codes for distinct randomness", () => {
    // Varying the first random byte across the whole 0..31 range yields 32
    // distinct codes (fake arithmetic sequences alias mod 32 over long runs,
    // so the injectivity check is kept exact instead of statistical).
    const codes = new Set<string>();
    for (let n = 0; n < 32; n += 1) {
      codes.add(
        generateCertificateCode((length) => {
          const bytes = new Uint8Array(length);
          bytes[0] = n;
          return bytes;
        }),
      );
    }
    assert.equal(codes.size, 32);
    assert.notEqual(generateCertificateCode(fakeRandomBytes(1)), generateCertificateCode(fakeRandomBytes(2)));
  });

  it("marks generated codes valid and confusable shapes invalid", () => {
    const code = generateCertificateCode(fakeRandomBytes(3));
    assert.equal(isValidCertificateCode(code), true);
    assert.equal(isValidCertificateCode(code.toLowerCase()), false);
    assert.equal(isValidCertificateCode(code.slice(1)), false);
    assert.equal(isValidCertificateCode("A".repeat(15) + "I"), false);
    assert.equal(isValidCertificateCode("A".repeat(15) + "O"), false);
    assert.equal(isValidCertificateCode(`${code}X`), false);
  });
});

describe("code normalization for lookup", () => {
  it("trims and uppercases a hand-typed code", () => {
    const code = generateCertificateCode(fakeRandomBytes(11));
    assert.equal(normalizeCertificateCode(`  ${code.toLowerCase()} `), code);
    assert.equal(isValidCertificateCode(normalizeCertificateCode(` ${code.toLowerCase()} `)), true);
  });

  it("keeps the wire param schema intentionally loose (format is not leaked)", () => {
    // The public route accepts 6-32 chars and resolves unknown codes to the
    // same 404; the strict 16-char alphabet check is issuance-internal.
    assert.equal(certificateCodeParamSchema.parse("dtgtestcode").length, 11);
    assert.throws(() => certificateCodeParamSchema.parse("abcde"));
    assert.throws(() => certificateCodeParamSchema.parse("a".repeat(33)));
  });
});

describe("idempotent issue and revocation decisions", () => {
  it("recognizes a unique-violation error by duck-typing its code", () => {
    assert.equal(isUniqueConstraintViolation({ code: "P2002" }), true);
    assert.equal(isUniqueConstraintViolation({ code: "P2025" }), false);
    assert.equal(isUniqueConstraintViolation(new Error("boom")), false);
    assert.equal(isUniqueConstraintViolation(null), false);
    assert.equal(isUniqueConstraintViolation(undefined), false);
  });

  it("revokes only once", () => {
    assert.equal(describeRevocationOutcome("ACTIVE"), "REVOKE");
    assert.equal(describeRevocationOutcome("REVOKED"), "ALREADY_REVOKED");
  });
});

describe("certificate wire contracts", () => {
  it("parses the learner's certificates plus claimable courses", () => {
    const payload = myCertificatesSchema.parse({
      certificates: [
        {
          id: UUID,
          code: "DTG1234ABCDEFGX9",
          courseId: UUID,
          courseSlug: "complete-nextjs-react-masterclass",
          courseTitle: "Complete Next.js & React Masterclass",
          status: "ACTIVE",
          issuedAt: "2026-02-01T10:00:00.000Z",
          revokedAt: null,
        },
      ],
      eligibleCourses: [{ courseId: UUID, slug: "react-basics", title: "React Basics" }],
    });
    assert.equal(payload.certificates[0].status, "ACTIVE");
    assert.equal(payload.eligibleCourses[0].slug, "react-basics");
    assert.throws(() =>
      myCertificatesSchema.parse({
        certificates: [],
        eligibleCourses: [{ courseId: "not-a-uuid", slug: "x", title: "X" }],
      }),
    );
  });

  it("parses the minimal public verification payload", () => {
    const verified = publicCertificateSchema.parse({
      code: "DTG1234ABCDEFGH",
      status: "REVOKED",
      issuedAt: "2026-02-01T10:00:00.000Z",
      learnerName: "Ada Lovelace",
      courseTitle: "React Basics",
      brandName: "DTG",
    });
    assert.equal(verified.status, "REVOKED");
    // The public payload must never grow an email field.
    assert.ok(!("email" in verified));
  });

  it("trims and bounds the revocation reason", () => {
    assert.equal(certificateRevokeSchema.parse({ reason: "  forged submission  " }).reason, "forged submission");
    assert.throws(() => certificateRevokeSchema.parse({ reason: "   " }));
    assert.throws(() => certificateRevokeSchema.parse({ reason: "x".repeat(501) }));
  });
});
