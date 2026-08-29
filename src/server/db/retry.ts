import { Prisma } from "@prisma/client";

const RETRY_DELAYS_MS = [150, 450] as const;

function isRetryableConnectionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientInitializationError && error.errorCode === "P1001";
}

export async function withDatabaseConnectionRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (const delayMs of RETRY_DELAYS_MS) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableConnectionError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return operation();
}
