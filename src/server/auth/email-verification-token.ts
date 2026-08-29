import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const TOKEN_LIFETIME_MS = 60 * 60 * 1_000;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function issueEmailVerificationToken(
  database: PrismaClient,
  email: string,
  token: string,
): Promise<void> {
  const identifier = `email-verification:${digest(email.trim().toLowerCase())}`;
  await database.$transaction([
    database.verification.deleteMany({ where: { identifier } }),
    database.verification.create({
      data: {
        identifier,
        value: digest(token),
        expiresAt: new Date(Date.now() + TOKEN_LIFETIME_MS),
      },
      select: { id: true },
    }),
  ]);
}

export async function consumeEmailVerificationToken(
  database: PrismaClient,
  token: string,
): Promise<boolean> {
  const result = await database.verification.deleteMany({
    where: {
      value: digest(token),
      identifier: { startsWith: "email-verification:" },
      expiresAt: { gt: new Date() },
    },
  });
  return result.count === 1;
}
