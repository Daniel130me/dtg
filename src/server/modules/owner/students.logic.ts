import {
  OWNER_USER_NOT_FOUND,
  OWNER_USER_STATUS_FORBIDDEN,
  type ManageableUserStatus,
} from "@/contracts/owner-ops";

// Pure decision logic for owner user-status operations. Keeping the guard
// here means the trust rules (never suspend yourself, never touch the OWNER
// account, never resurrect DELETED users) are unit-testable without a
// database, while the service only translates a rejected decision into the
// client-matchable ApiError.

export interface UserStatusChangeTarget {
  id: string;
  role: "STUDENT" | "OWNER";
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
}

export type UserStatusChangeDecision =
  | { ok: true; noop: boolean }
  | { ok: false; code: typeof OWNER_USER_NOT_FOUND | typeof OWNER_USER_STATUS_FORBIDDEN };

/**
 * Decides whether `actorId` may move `target` to `next`.
 *
 * Order matters and is deliberate:
 * 1. A DELETED target reads as absent (404 OWNER_USER_NOT_FOUND) — deleted
 *    accounts are never restorable from this endpoint (metrics doc,
 *    "Student management").
 * 2. Self-targets and OWNER-role targets are refused with 422
 *    OWNER_USER_STATUS_FORBIDDEN — the platform must always keep at least one
 *    reachable owner, and an owner locking themselves out would need another
 *    owner to unlock them (none exists by design).
 * 3. Everything else is allowed; `noop` marks the ACTIVE→ACTIVE /
 *    SUSPENDED→SUSPENDED repeats so the service can skip session revocation
 *    and audit noise for a request that changes nothing.
 */
export function evaluateUserStatusChange(
  actorId: string,
  target: UserStatusChangeTarget,
  next: ManageableUserStatus,
): UserStatusChangeDecision {
  if (target.status === "DELETED") return { ok: false, code: OWNER_USER_NOT_FOUND };
  if (target.id === actorId || target.role === "OWNER") {
    return { ok: false, code: OWNER_USER_STATUS_FORBIDDEN };
  }
  return { ok: true, noop: target.status === next };
}

/** Audit action vocabulary for the status endpoint (REVIEW_AUDIT style). */
export const USER_STATUS_AUDIT = {
  suspended: "user.suspended",
  reactivated: "user.reactivated",
} as const;
