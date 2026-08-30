import { z } from "zod";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { markNotificationRead } from "@/server/modules/notifications/notifications.service";

interface RouteParams {
  params: Promise<{ notificationId: string }>;
}

const notificationIdParamSchema = z.uuid();

// Idempotent mark-read: repeated POSTs stay 200 (see service contract);
// another user's id reads as a plain 404.
export async function POST(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const { notificationId } = await params;
    return apiSuccess(
      context,
      await markNotificationRead(user.id, parsePathParam(notificationIdParamSchema, notificationId)),
    );
  });
}
