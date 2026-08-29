import { listActiveCategories } from "@/server/modules/catalog/catalog.service";
import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";

export async function GET(request: Request) {
  return executeRoute(request, async (context) => {
    const categories = await listActiveCategories();
    return apiSuccess(context, { categories });
  });
}
