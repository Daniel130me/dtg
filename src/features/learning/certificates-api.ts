import type { CertificateDto, MyCertificatesDto } from "@/contracts/certificates";
import { apiRequest } from "@/lib/client/api-client";

const BASE_PATH = "/api/v1";

/** GET /api/v1/learning/certificates — issued certificates + claimable courses. */
export function fetchMyCertificates(): Promise<MyCertificatesDto> {
  return apiRequest<MyCertificatesDto>(`${BASE_PATH}/learning/certificates`);
}

/**
 * POST /api/v1/learning/courses/{slug}/certificate — idempotent claim: the
 * server returns the existing certificate unchanged when one already exists.
 */
export function claimCertificate(slug: string): Promise<CertificateDto> {
  return apiRequest<CertificateDto>(
    `${BASE_PATH}/learning/courses/${encodeURIComponent(slug)}/certificate`,
    { method: "POST" },
  );
}

/**
 * The PDF download is a plain authenticated GET (browser handles the binary +
 * Content-Disposition), so it is exposed as a URL rather than an apiRequest
 * wrapper. Only usable for a certificate the caller owns.
 */
export function certificateDownloadUrl(certificateId: string): string {
  return `${BASE_PATH}/learning/certificates/${encodeURIComponent(certificateId)}/download`;
}

/** Public verification deep link (no auth) — used for the "verify" affordances. */
export function certificateVerifyUrl(code: string): string {
  return `/certificates/${encodeURIComponent(code)}`;
}
