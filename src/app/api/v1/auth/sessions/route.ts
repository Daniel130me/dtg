import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { db } from "@/server/db/client";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const { user, sessionId } = await requireAuthenticatedUser(request.headers);
    const sessions = await db.session.findMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
      },
    });
    return apiSuccess(context, {
      sessions: sessions.map((session) => ({ ...session, current: session.id === sessionId })),
    });
  });
}
