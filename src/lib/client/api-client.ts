import type { ApiErrorDetail, ApiFailure, ApiSuccess } from "@/contracts/api";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("accept", "application/json");

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  const requestId = response.headers.get("x-request-id") ?? undefined;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("json")) {
    throw new ApiClientError(
      response.status,
      "UNEXPECTED_RESPONSE",
      "The server returned an unexpected response. Please try again.",
      requestId,
    );
  }

  let payload: ApiSuccess<T> | ApiFailure;
  try {
    payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  } catch {
    throw new ApiClientError(
      response.status,
      "UNEXPECTED_RESPONSE",
      "The server returned an unreadable response. Please try again.",
      requestId,
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiClientError(
      response.status,
      "UNEXPECTED_RESPONSE",
      "The server returned an invalid response. Please try again.",
      requestId,
    );
  }

  if (!response.ok || "error" in payload) {
    const failure = "error" in payload ? payload.error : undefined;
    throw new ApiClientError(
      response.status,
      failure?.code ?? "UNEXPECTED_RESPONSE",
      failure?.message ?? "The server returned an unexpected response.",
      failure?.requestId,
      failure?.details,
    );
  }

  if (!("data" in payload)) {
    throw new ApiClientError(
      response.status,
      "UNEXPECTED_RESPONSE",
      "The server returned an incomplete response. Please try again.",
      requestId,
    );
  }

  return payload.data;
}
