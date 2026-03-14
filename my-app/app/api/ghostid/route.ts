import { auth } from "@clerk/nextjs/server";
import {
  apiSuccess,
  handleApiError,
  unauthorizedError,
} from "../../lib/api";
import { getOrCreateGhostId } from "../../lib/ghostid";
import { prisma } from "../../lib/prisma";

export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return unauthorizedError();
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { ghostId: true, walletAddress: true },
    });

    return apiSuccess({ ghostId: user?.ghostId ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return unauthorizedError();
    }

    const ghostId = await getOrCreateGhostId(userId);

    return apiSuccess({ ghostId });
  } catch (error) {
    return handleApiError(error);
  }
}
