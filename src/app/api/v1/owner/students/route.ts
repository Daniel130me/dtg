import { ownerStudentListQuerySchema } from "@/contracts/owner-ops";
import { requireOwner } from "@/server/auth/authorization";
import { validationError } from "@/server/http/errors";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { listOwnerStudents } from "@/server/modules/owner/students.service";

// Owner student directory: newest learners first, cursor-paginated, optional
// q search and status filter. Empty query params are dropped so a blank
// `status=` does not fail the enum parse (same treatment as the grading
// queue).

function searchParamsToObject(url: URL): Record<string, string> {
  return Object.fromEntries(
    [...url.searchParams.entries()].filter(([, value]) => value.length > 0),
  );
}

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const query = ownerStudentListQuerySchema.safeParse(
      searchParamsToObject(new URL(request.url)),
    );
    if (!query.success) throw validationError(query.error);
    return apiSuccess(context, await listOwnerStudents(query.data));
  });
}
