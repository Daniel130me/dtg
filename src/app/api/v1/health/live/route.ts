import { apiSuccess } from "@/server/http/responses";
import { executeRoute } from "@/server/http/route-handler";

export function GET(request: Request) {
  return executeRoute(request, (context) => apiSuccess(context, { status: "ok" }));
}
