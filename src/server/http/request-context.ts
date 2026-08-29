const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export interface RequestContext {
  requestId: string;
  startedAt: number;
  corsOrigin?: string;
}

export function createRequestContext(request: Request): RequestContext {
  const incoming = request.headers.get("x-request-id")?.trim();
  return {
    requestId: incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID(),
    startedAt: Date.now(),
  };
}
