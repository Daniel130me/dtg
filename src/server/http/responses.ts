import { NextResponse } from "next/server";
import type { ApiFailure, ApiSuccess } from "@/contracts/api";
import { ApiError, mapInfrastructureError } from "@/server/http/errors";
import type { RequestContext } from "@/server/http/request-context";
import { logger } from "@/server/observability/logger";

function responseHeaders(context: RequestContext): HeadersInit {
  return {
    "cache-control": "no-store",
    "x-request-id": context.requestId,
    ...(context.corsOrigin
      ? {
          "access-control-allow-origin": context.corsOrigin,
          "access-control-allow-credentials": "true",
          vary: "Origin",
        }
      : {}),
  };
}

export function apiSuccess<T>(
  context: RequestContext,
  data: T,
  status = 200,
): NextResponse<ApiSuccess<T>> {
  return NextResponse.json(
    { data, meta: { requestId: context.requestId } },
    { status, headers: responseHeaders(context) },
  );
}

export function apiFailure(
  context: RequestContext,
  error: ApiError,
): NextResponse<ApiFailure> {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        requestId: context.requestId,
        ...(error.details ? { details: error.details } : {}),
      },
    },
    { status: error.status, headers: responseHeaders(context) },
  );
}

export function handleRouteError(
  context: RequestContext,
  error: unknown,
): NextResponse<ApiFailure> {
  const mapped = error instanceof ApiError ? error : mapInfrastructureError(error);
  if (mapped) {
    if (mapped.status >= 500) logger.error("API request failed", { requestId: context.requestId, error });
    return apiFailure(context, mapped);
  }

  logger.error("Unhandled API request error", { requestId: context.requestId, error });
  return apiFailure(
    context,
    new ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred."),
  );
}
