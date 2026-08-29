import { provisionInitialOwner } from "@/server/modules/owner/owner.service";

async function main(): Promise<void> {
  if (process.env.ALLOW_OWNER_BOOTSTRAP !== "true") {
    throw new Error("Set ALLOW_OWNER_BOOTSTRAP=true explicitly to run owner provisioning.");
  }

  const email = process.env.OWNER_EMAIL;
  const displayName = process.env.OWNER_DISPLAY_NAME;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !displayName || !password) {
    throw new Error("OWNER_EMAIL, OWNER_DISPLAY_NAME, and OWNER_PASSWORD are required.");
  }

  const owner = await provisionInitialOwner({ email, displayName, password });
  console.info(`Owner provisioned with id ${owner.id}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Owner provisioning failed.");
  process.exitCode = 1;
});
