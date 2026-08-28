import { Prisma } from "@prisma/client";
import { db } from "@/server/db/client";

export type TransactionClient = Prisma.TransactionClient;

const DEFAULT_MAX_WAIT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface TransactionOptions {
  maxWaitMs?: number;
  timeoutMs?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

export function withTransaction<T>(
  operation: (transaction: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return db.$transaction(operation, {
    maxWait: options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}
