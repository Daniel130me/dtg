import { z } from "zod";

export const provisionOwnerSchema = z.object({
  email: z.email().max(320).transform((value) => value.trim().toLowerCase()),
  displayName: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(128),
});

export const transferOwnerSchema = z.object({
  currentOwnerId: z.uuid(),
  nextOwnerId: z.uuid(),
  requestId: z.string().max(64).optional(),
});

export type ProvisionOwnerInput = z.infer<typeof provisionOwnerSchema>;
export type TransferOwnerInput = z.infer<typeof transferOwnerSchema>;
