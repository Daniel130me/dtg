import type { ApiFailure, ApiSuccess } from "@/contracts/api";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
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

  const payload = (await response.json()) as ApiSuccess<T> | ApiFailure;
  if (!response.ok || "error" in payload) {
    const failure = "error" in payload ? payload.error : undefined;
    throw new ApiClientError(
      response.status,
      failure?.code ?? "UNEXPECTED_RESPONSE",
      failure?.message ?? "The server returned an unexpected response.",
      failure?.requestId,
    );
  }

  return payload.data;
}
