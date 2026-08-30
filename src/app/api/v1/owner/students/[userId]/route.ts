import { z } from "zod";
import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parsePathParam } from "@/server/modules/courses/courses.schemas";
import { getOwnerStudent } from "@/server/modules/owner/students.service";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

// Owner student detail. contracts/owner-ops.ts carries no path-param schema,
// so the route validates the id inline (parsePathParam + z.uuid, the same
// inline pattern the owner review routes use).

export async function GET(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { userId } = await params;
    return apiSuccess(
      context,
      await getOwnerStudent(parsePathParam(z.uuid(), userId)),
    );
  });
}
