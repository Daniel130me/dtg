import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ApiError } from "@/server/http/errors";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,255}$/;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

export interface StoredResponse {
  status: number;
  body: Prisma.InputJsonValue;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(",")}}`;
}

export function hashIdempotentRequest(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

export async function executeIdempotent(
  scope: string,
  key: string | null,
  payload: unknown,
  operation: () => Promise<StoredResponse>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<StoredResponse & { replayed: boolean }> {
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "A valid Idempotency-Key header is required.");
  }

  const requestHash = hashIdempotentRequest(payload);
  const expiresAt = new Date(Date.now() + ttlMs);
  const { db } = await import("@/server/db/client");

  try {
    await db.idempotencyKey.create({ data: { scope, key, requestHash, expiresAt } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await db.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
    if (!existing || existing.expiresAt <= new Date()) {
      throw new ApiError(409, "IDEMPOTENCY_EXPIRED", "The idempotency record is no longer usable.");
    }
    if (existing.requestHash !== requestHash) {
      throw new ApiError(409, "IDEMPOTENCY_MISMATCH", "This idempotency key was used for a different request.");
    }
    if (existing.status !== "COMPLETED" || existing.responseStatus === null || existing.responseBody === null) {
      throw new ApiError(409, "REQUEST_IN_PROGRESS", "A request with this idempotency key is still processing.");
    }
    return { status: existing.responseStatus, body: existing.responseBody as Prisma.InputJsonValue, replayed: true };
  }

  try {
    const response = await operation();
    await db.idempotencyKey.update({
      where: { scope_key: { scope, key } },
      data: {
        status: "COMPLETED",
        responseStatus: response.status,
        responseBody: response.body,
      },
    });
    return { ...response, replayed: false };
  } catch (error) {
    await db.idempotencyKey.delete({ where: { scope_key: { scope, key } } }).catch(() => undefined);
    throw error;
  }
}
