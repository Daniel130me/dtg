import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { markAllNotificationsRead } from "@/server/modules/notifications/notifications.service";

// Marks every unread notification of the caller read; the count of rows
// actually touched (already-read rows are never re-stamped).
export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    return apiSuccess(context, await markAllNotificationsRead(user.id));
  });
}
