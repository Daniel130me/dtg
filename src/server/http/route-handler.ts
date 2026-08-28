import type { NextResponse } from "next/server";
import type { ApiFailure } from "@/contracts/api";
import { assertAllowedOrigin } from "@/server/http/cors";
import { createRequestContext, type RequestContext } from "@/server/http/request-context";
import { handleRouteError } from "@/server/http/responses";
import { logger } from "@/server/observability/logger";

export async function executeRoute<TResponse extends NextResponse>(
  request: Request,
  handler: (context: RequestContext) => Promise<TResponse> | TResponse,
): Promise<TResponse | NextResponse<ApiFailure>> {
  const context = createRequestContext(request);
  let status = 500;

  try {
    assertAllowedOrigin(request);
    const origin = request.headers.get("origin")?.trim();
    if (origin) context.corsOrigin = origin;
    const response = await handler(context);
    status = response.status;
    return response;
  } catch (error) {
    const response = handleRouteError(context, error);
    status = response.status;
    return response;
  } finally {
    logger.info("API request completed", {
      requestId: context.requestId,
      method: request.method,
      pathname: new URL(request.url).pathname,
      status,
      durationMs: Date.now() - context.startedAt,
    });
  }
}
