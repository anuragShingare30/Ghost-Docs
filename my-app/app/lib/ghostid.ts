import crypto from "crypto";
import { prisma } from "./prisma";

export function generateGhostId() {
  return `ghost-${crypto.randomBytes(4).toString("hex")}`;
}

export async function getOrCreateGhostId(clerkId: string) {
  try {
    const existing = await prisma.user.findUnique({
      where: { clerkId },
      select: { ghostId: true },
    });

    if (existing?.ghostId) {
      return existing.ghostId;
    }

    let ghostId = generateGhostId();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const created = await prisma.user.create({
          data: { clerkId, ghostId },
          select: { ghostId: true },
        });
        return created.ghostId;
      } catch (error) {
        ghostId = generateGhostId();
        if (attempt === 4) {
          throw error;
        }
      }
    }

    return ghostId;
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to create GhostID."
    );
  }
}
