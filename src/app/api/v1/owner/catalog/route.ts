import { requireOwner } from "@/server/auth/authorization";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";
import { parseJsonBody } from "@/server/http/validation";
import {
  createOwnerCategory,
  createOwnerLevel,
  listOwnerCatalogOptions,
} from "@/server/modules/catalog/catalog-options.service";
import { z } from "zod";

const createOptionSchema = z.object({
  type: z.enum(["category", "level"]),
  name: z.string(),
});

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    return apiSuccess(context, await listOwnerCatalogOptions());
  });
}

export async function POST(request: Request) {
  return executeRoute(request, async (context) => {
    await requireOwner(request.headers);
    const input = await parseJsonBody(request, createOptionSchema);
    const option = input.type === "category"
      ? await createOwnerCategory(input)
      : await createOwnerLevel(input);
    return apiSuccess(context, { option }, 201);
  });
}