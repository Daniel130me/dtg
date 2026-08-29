import { enrolmentListQuerySchema } from "@/contracts/enrolments";
import { requireAuthenticatedUser } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listMyEnrolments } from "@/server/modules/enrolments/enrolments.service";

function searchParamsToObject(url: URL): Record<string, string> {
  // Empty strings are dropped so omitted params fall back to schema defaults
  // (z.coerce would turn `limit=` into 0 instead of the default).
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const { user } = await requireAuthenticatedUser(request.headers);
    const result = enrolmentListQuerySchema.safeParse(searchParamsToObject(new URL(request.url)));
    if (!result.success) throw validationError(result.error);
    const page = await listMyEnrolments(user.id, result.data);
    return apiSuccess(context, page);
  });
}
