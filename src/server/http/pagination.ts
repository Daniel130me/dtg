import { z } from "zod";
import { ApiError } from "@/server/http/errors";

const cursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

export type Cursor = z.infer<typeof cursorSchema>;

/**
 * Keyset cursor for lists sorted by a non-createdAt activity timestamp
 * (e.g. discussion threads on lastActivityAt). Kept separate from Cursor so
 * each list's sort key stays explicit in the encoded payload.
 */
const activityCursorSchema = z.object({
  lastActivityAt: z.iso.datetime(),
  id: z.uuid(),
});

export type ActivityCursor = z.infer<typeof activityCursorSchema>;

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return cursorSchema.parse(decoded);
  } catch {
    throw new ApiError(422, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeActivityCursor(value: string): ActivityCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return activityCursorSchema.parse(decoded);
  } catch {
    throw new ApiError(422, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }
}
