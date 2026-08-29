import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development seed data cannot be loaded in production.");
  }

  await prisma.user.upsert({
    where: { emailNormalized: "student@example.test" },
    update: {},
    create: {
      name: "Demo Student",
      email: "student@example.test",
      emailNormalized: "student@example.test",
      profile: { create: { displayName: "Demo Student", countryCode: "NG", timezone: "Africa/Lagos" } },
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Database seeding failed.");
    await prisma.$disconnect();
    process.exitCode = 1;
  });
