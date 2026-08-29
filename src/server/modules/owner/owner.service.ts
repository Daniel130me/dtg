import { Prisma } from "@prisma/client";
import { db } from "@/server/db/client";
import { hashPassword } from "@/server/auth/password";
import { ApiError } from "@/server/http/errors";
import {
  provisionOwnerSchema,
  transferOwnerSchema,
  type ProvisionOwnerInput,
  type TransferOwnerInput,
} from "@/server/modules/owner/owner.schemas";

export async function provisionInitialOwner(input: ProvisionOwnerInput) {
  const value = provisionOwnerSchema.parse(input);
  const password = await hashPassword(value.password);
  return db.$transaction(
    async (transaction) => {
      const settings = await transaction.platformSettings.findUnique({ where: { id: "platform" } });
      if (settings) throw new ApiError(409, "OWNER_ALREADY_PROVISIONED", "The platform owner is already provisioned.");

      const owner = await transaction.user.upsert({
        where: { emailNormalized: value.email },
        create: {
          name: value.displayName,
          email: value.email,
          emailNormalized: value.email,
          emailVerified: true,
          role: "OWNER",
          profile: { create: { displayName: value.displayName } },
        },
        update: { name: value.displayName, role: "OWNER", status: "ACTIVE", emailVerified: true },
        select: { id: true, email: true, role: true },
      });

      await transaction.account.upsert({
        where: { issuer_accountId: { issuer: "local:credential", accountId: owner.id } },
        create: {
          issuer: "local:credential",
          accountId: owner.id,
          providerId: "credential",
          userId: owner.id,
          password,
        },
        update: { password },
        select: { id: true },
      });

      await transaction.platformSettings.create({
        data: { id: "platform", ownerUserId: owner.id },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: "platform.owner.provisioned",
          entityType: "PlatformSettings",
          entityId: "platform",
        },
      });
      return owner;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function transferPlatformOwnership(input: TransferOwnerInput) {
  const value = transferOwnerSchema.parse(input);
  if (value.currentOwnerId === value.nextOwnerId) {
    throw new ApiError(422, "OWNER_UNCHANGED", "The next owner must be a different user.");
  }

  return db.$transaction(
    async (transaction) => {
      const settings = await transaction.platformSettings.findUnique({ where: { id: "platform" } });
      if (!settings || settings.ownerUserId !== value.currentOwnerId) {
        throw new ApiError(403, "OWNER_TRANSFER_FORBIDDEN", "Only the current owner can transfer ownership.");
      }

      const nextOwner = await transaction.user.findUnique({
        where: { id: value.nextOwnerId },
        select: { id: true, status: true },
      });
      if (!nextOwner || nextOwner.status !== "ACTIVE") {
        throw new ApiError(422, "INVALID_NEXT_OWNER", "The next owner must be an active user.");
      }

      await transaction.user.update({ where: { id: value.currentOwnerId }, data: { role: "STUDENT" } });
      await transaction.user.update({ where: { id: value.nextOwnerId }, data: { role: "OWNER" } });
      await transaction.platformSettings.update({
        where: { id: "platform" },
        data: { ownerUserId: value.nextOwnerId },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: value.currentOwnerId,
          action: "platform.owner.transferred",
          entityType: "PlatformSettings",
          entityId: "platform",
          requestId: value.requestId,
          metadata: { previousOwnerId: value.currentOwnerId, nextOwnerId: value.nextOwnerId },
        },
      });
      return { ownerUserId: value.nextOwnerId };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
