import { auth } from "@clerk/nextjs/server";
import {
  apiError,
  apiSuccess,
  handleApiError,
  parseRequestJson,
  unauthorizedError,
} from "../../lib/api";
import { getOrCreateGhostId } from "../../lib/ghostid";
import { prisma } from "../../lib/prisma";

type WalletLinkPayload = {
  walletAddress?: string;
};

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return unauthorizedError();
    }

    const body = await parseRequestJson<WalletLinkPayload>(request);
    const walletAddress = body.walletAddress?.trim().toLowerCase();

    if (!walletAddress) {
      return apiError("Wallet address is required.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const ghostId = await getOrCreateGhostId(userId);

    await prisma.user.update({
      where: { clerkId: userId },
      data: { walletAddress },
    });

    return apiSuccess({ ghostId, walletAddress });
  } catch (error) {
    return handleApiError(error);
  }
}
