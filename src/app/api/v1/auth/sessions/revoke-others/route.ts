import { auth } from "@/server/auth/auth";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { db } from "@/server/db/client";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";

export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    await auth.api.revokeOtherSessions({ headers: request.headers });
    await db.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "AUTH_OTHER_SESSIONS_REVOKED",
        entityType: "Session",
        requestId: context.requestId,
      },
      select: { id: true },
    });
    return apiSuccess(context, { revoked: true });
  });
}
