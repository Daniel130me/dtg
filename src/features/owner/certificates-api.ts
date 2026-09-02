import type {
  CertificateDto,
  OwnerCertificatesQueryInput,
  PaginatedOwnerCertificatesDto,
} from "@/contracts/certificates";
import { apiRequest } from "@/lib/client/api-client";

const OWNER_API_BASE = "/api/v1/owner";

// Owner certificate console wrappers. The list mirrors the grading queue's
// cursor pagination; revocation is idempotent server-side and answers with the
// certificate's current state (CertificateDto), so a double-submit or a
// revoke-of-revoked simply returns the same record.

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

/** GET /api/v1/owner/certificates — cursor-paginated issue records. */
export function fetchOwnerCertificates(
  query: OwnerCertificatesQueryInput = {},
): Promise<PaginatedOwnerCertificatesDto> {
  const path = `${OWNER_API_BASE}/certificates${buildQueryString(query)}`;
  return apiRequest<PaginatedOwnerCertificatesDto>(path);
}

/** POST /api/v1/owner/certificates/{certificateId}/revoke — flips ACTIVE -> REVOKED. */
export function revokeOwnerCertificate(
  certificateId: string,
  input: { reason: string },
): Promise<CertificateDto> {
  return apiRequest<CertificateDto>(
    `${OWNER_API_BASE}/certificates/${encodeURIComponent(certificateId)}/revoke`,
    { method: "POST", body: JSON.stringify(input) },
  );
}
