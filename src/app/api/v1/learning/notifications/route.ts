import { notificationListQuerySchema } from "@/contracts/notifications";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listNotifications } from "@/server/modules/notifications/notifications.service";
import { triggerBackgroundDispatch } from "@/server/modules/notifications/outbox.dispatcher";

// The learner's inbox. Reading it opportunistically drains pending outbox
// events (fire-and-forget, never awaited on the request path): a cheap
// self-heal so confirmations/grades/certificates surface even without a cron.

function searchParamsToObject(url: URL): Record<string, string> {
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const query = notificationListQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
    if (!query.success) throw validationError(query.error);

    void triggerBackgroundDispatch();

    return apiSuccess(context, await listNotifications(user.id, query.data));
  });
}
