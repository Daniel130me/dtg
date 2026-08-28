import { PrismaClient } from "@prisma/client";
import { getServerEnv } from "@/server/config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const env = getServerEnv();
  return new PrismaClient({
    log: env.NODE_ENV === "development" && env.LOG_LEVEL === "debug"
      ? ["query", "warn", "error"]
      : ["warn", "error"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (getServerEnv().NODE_ENV !== "production") globalForPrisma.prisma = db;

export type DatabaseClient = PrismaClient;
