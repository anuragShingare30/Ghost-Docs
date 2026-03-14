import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing DATABASE_URL in environment variables.");
}

const adapter = new PrismaNeon({ connectionString: databaseUrl });

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
