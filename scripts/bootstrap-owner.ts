import { provisionInitialOwner } from "@/server/modules/owner/owner.service";

async function main(): Promise<void> {
  if (process.env.ALLOW_OWNER_BOOTSTRAP !== "true") {
    throw new Error("Set ALLOW_OWNER_BOOTSTRAP=true explicitly to run owner provisioning.");
  }

  const email = process.env.OWNER_EMAIL;
  const displayName = process.env.OWNER_DISPLAY_NAME;
  if (!email || !displayName) throw new Error("OWNER_EMAIL and OWNER_DISPLAY_NAME are required.");

  const owner = await provisionInitialOwner({ email, displayName });
  console.info(`Owner provisioned with id ${owner.id}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Owner provisioning failed.");
  process.exitCode = 1;
});
