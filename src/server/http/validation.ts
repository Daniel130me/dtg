import { z } from "zod";
import { ApiError, validationError } from "@/server/http/errors";

export const DEFAULT_MAX_JSON_BYTES = 64 * 1024;

export async function parseJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<z.infer<TSchema>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }

  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function parseSearchParams<TSchema extends z.ZodType>(
  url: URL,
  schema: TSchema,
): z.infer<TSchema> {
  const values = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(values);
  if (!result.success) throw validationError(result.error);
  return result.data;
}
