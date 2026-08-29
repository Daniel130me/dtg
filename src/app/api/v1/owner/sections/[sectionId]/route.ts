import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import { deleteSection, renameSection } from "@/server/modules/courses/curriculum.service";
import {
  parsePathParam,
  sectionIdParamSchema,
  sectionUpdateSchema,
} from "@/server/modules/courses/courses.schemas";

interface RouteParams {
  params: Promise<{ sectionId: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { sectionId } = await params;
    const input = await parseJsonBody(request, sectionUpdateSchema);
    const result = await renameSection(parsePathParam(sectionIdParamSchema, sectionId), input);
    return apiSuccess(context, result);
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const { sectionId } = await params;
    const deleted = await deleteSection(parsePathParam(sectionIdParamSchema, sectionId));
    return apiSuccess(context, { deleted: true, ...deleted });
  });
}
