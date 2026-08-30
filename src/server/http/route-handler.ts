import type { NextResponse } from "next/server";
import type { ApiFailure } from "@/contracts/api";
import { assertAllowedOrigin } from "@/server/http/cors";
import { createRequestContext, type RequestContext } from "@/server/http/request-context";
import { handleRouteError } from "@/server/http/responses";
import { captureError } from "@/server/observability/error-monitor";
import { logger } from "@/server/observability/logger";
import { recordHttpRequest } from "@/server/observability/metrics";

export async function executeRoute<TResponse extends NextResponse>(
  request: Request,
  handler: (context: RequestContext) => Promise<TResponse> | TResponse,
): Promise<TResponse | NextResponse<ApiFailure>> {
  const context = createRequestContext(request);
  const route = `${request.method} ${new URL(request.url).pathname}`;
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
    // 4xx are expected client errors; only 5xx are worth full error capture.
    if (status >= 500) captureError(error, { requestId: context.requestId, route });
    return response;
  } finally {
    const durationMs = Date.now() - context.startedAt;
    recordHttpRequest(status, durationMs);
    logger.info("API request completed", {
      requestId: context.requestId,
      method: request.method,
      pathname: new URL(request.url).pathname,
      status,
      durationMs,
    });
  }
}
