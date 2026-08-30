import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { getUnreadNotificationCount } from "@/server/modules/notifications/notifications.service";

// Badge probe for the header bell: one count, pinned to the caller.
export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    return apiSuccess(context, await getUnreadNotificationCount(user.id));
  });
}
