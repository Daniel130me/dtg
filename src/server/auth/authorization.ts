import type { UserRole } from "@prisma/client";
import { auth } from "@/server/auth/auth";
import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";

export interface AuthorizedUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
}

export async function requireAuthenticatedUser(headers: Headers): Promise<{
  user: AuthorizedUser;
  sessionId: string;
}> {
  const session = await auth.api.getSession({ headers });
  if (!session) throw new ApiError(401, "UNAUTHENTICATED", "Authentication is required.");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      role: true,
      status: true,
    },
  });
  if (!user || user.status !== "ACTIVE") {
    throw new ApiError(401, "SESSION_INVALID", "The session is no longer valid.");
  }

  const { status: _status, ...authorizedUser } = user;
  return { user: authorizedUser, sessionId: session.session.id };
}

export async function requireOwner(headers: Headers): Promise<AuthorizedUser> {
  const { user } = await requireAuthenticatedUser(headers);
  const ownership = await db.platformSettings.findUnique({
    where: { id: "platform" },
    select: { ownerUserId: true },
  });
  if (user.role !== "OWNER" || ownership?.ownerUserId !== user.id) {
    throw new ApiError(403, "FORBIDDEN", "Owner access is required.");
  }
  return user;
}

export function assertStudentResourceOwner(authenticatedUserId: string, resourceUserId: string): void {
  if (authenticatedUserId !== resourceUserId) {
    throw new ApiError(403, "FORBIDDEN", "You cannot access this resource.");
  }
}
