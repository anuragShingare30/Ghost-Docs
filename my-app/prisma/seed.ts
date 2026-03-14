import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../app/generated/prisma";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL in environment variables.");
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: databaseUrl }),
});

async function main() {
  if (process.env.ENABLE_DEMO_SEED !== "true") {
    console.log(
      "Skipping seed. Set ENABLE_DEMO_SEED=true to seed demo data intentionally."
    );
    return;
  }

  const demoUser = await prisma.user.upsert({
    where: { clerkId: "seed-user" },
    update: {},
    create: {
      clerkId: "seed-user",
      ghostId: "ghost-seed01",
      walletAddress: "0x0000000000000000000000000000000000000000",
    },
  });

  await prisma.document.create({
    data: {
      ownerId: demoUser.id,
      title: "Seed Document",
      access: "PRIVATE",
      permissions: {
        create: {
          userId: demoUser.id,
          role: "OWNER",
        },
      },
      auditEvents: {
        create: {
          actorId: demoUser.id,
          eventType: "DOCUMENT_CREATED",
          metadata: { source: "seed" },
        },
      },
    },
  });

  console.log("Demo seed completed.");
}

main()
  .catch((error) => {
    console.error("Seed failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
