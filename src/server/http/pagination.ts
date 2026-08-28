import { z } from "zod";
import { ApiError } from "@/server/http/errors";

const cursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

export type Cursor = z.infer<typeof cursorSchema>;

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
