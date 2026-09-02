import { z } from "zod";

// ---------------------------------------------------------------------------
// Named constants and codes (no magic values)
// ---------------------------------------------------------------------------

export const CERTIFICATE_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type CertificateStatusValue = (typeof CERTIFICATE_STATUSES)[number];

export const CERTIFICATE_CODE_LENGTH = 16;
export const CERTIFICATE_REVOKED_REASON_MAX = 500;

export const CERTIFICATE_NOT_ELIGIBLE = "CERTIFICATE_NOT_ELIGIBLE";
export const CERTIFICATE_NOT_FOUND = "CERTIFICATE_NOT_FOUND";
export const CERTIFICATE_REVOKED = "CERTIFICATE_REVOKED";

// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------

/** The learner's own certificate view. */
export const certificateDtoSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  courseId: z.uuid(),
  courseSlug: z.string(),
  courseTitle: z.string(),
  status: z.enum(CERTIFICATE_STATUSES),
  issuedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});

/**
 * GET /learning/certificates: the learner's issued certificates plus the
 * completed courses that are still claimable (all lessons completed, every
 * quiz passed, every assignment graded, no certificate yet).
 */
export const myCertificatesSchema = z.object({
  certificates: z.array(certificateDtoSchema),
  eligibleCourses: z.array(
    z.object({
      courseId: z.uuid(),
      slug: z.string(),
      title: z.string(),
    }),
  ),
});

/**
 * Public verification payload: deliberately minimal personal information —
 * the learner's display name and the course title, never an email.
 */
export const publicCertificateSchema = z.object({
  code: z.string(),
  status: z.enum(CERTIFICATE_STATUSES),
  issuedAt: z.iso.datetime(),
  learnerName: z.string(),
  courseTitle: z.string(),
  brandName: z.string(),
});

/** Body of the owner revocation endpoint. */
export const certificateRevokeSchema = z.object({
  reason: z.string().trim().min(1).max(CERTIFICATE_REVOKED_REASON_MAX),
});

// ---------------------------------------------------------------------------
// Owner console contracts (list + revoke)
// ---------------------------------------------------------------------------

/** Bounded reads: page size for the owner certificate list. */
export const OWNER_CERTIFICATES_LIMIT_DEFAULT = 20;
export const OWNER_CERTIFICATES_LIMIT_MAX = 50;
/** Search box bound (matches by learner name/email or certificate code). */
export const OWNER_CERTIFICATES_SEARCH_MAX = 191;

export const ownerCertificatesQuerySchema = z.object({
  courseId: z.uuid().optional(),
  status: z.enum(CERTIFICATE_STATUSES).optional(),
  search: z.string().trim().max(OWNER_CERTIFICATES_SEARCH_MAX).optional(),
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(OWNER_CERTIFICATES_LIMIT_MAX)
    .default(OWNER_CERTIFICATES_LIMIT_DEFAULT),
});

export const ownerCertificateListItemSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  status: z.enum(CERTIFICATE_STATUSES),
  issuedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  revokedReason: z.string().nullable(),
  learner: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  course: z.object({ id: z.uuid(), title: z.string(), slug: z.string() }),
});

export const paginatedOwnerCertificatesSchema = z.object({
  items: z.array(ownerCertificateListItemSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Path parameter schemas
// ---------------------------------------------------------------------------

export const certificateIdParamSchema = z.uuid();
export const certificateCodeParamSchema = z.string().min(6).max(32);

export type CertificateDto = z.infer<typeof certificateDtoSchema>;
export type MyCertificatesDto = z.infer<typeof myCertificatesSchema>;
export type PublicCertificateDto = z.infer<typeof publicCertificateSchema>;
export type OwnerCertificatesQueryInput = z.input<typeof ownerCertificatesQuerySchema>;
export type OwnerCertificateListItemDto = z.infer<typeof ownerCertificateListItemSchema>;
export type PaginatedOwnerCertificatesDto = z.infer<typeof paginatedOwnerCertificatesSchema>;
