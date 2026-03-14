import { auth } from "@clerk/nextjs/server";
import {
  apiError,
  apiSuccess,
  handleApiError,
  parseRequestJson,
} from "../../../../lib/api";
import { prisma } from "../../../../lib/prisma";
import { enforceRateLimit } from "../../../../lib/rate-limit";

type AccessCheckPayload = {
  token?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const rateLimited = enforceRateLimit({
      request,
      keyPrefix: "access-check",
      limit: 60,
      windowMs: 60_000,
    });
    if (rateLimited) {
      return rateLimited;
    }

    const payload = await parseRequestJson<AccessCheckPayload>(request);
    const token = payload.token?.trim();
    const { userId } = await auth();

    const document = await prisma.document.findUnique({
      where: { id },
      select: { id: true, access: true, ownerId: true },
    });

    if (!document) {
      return apiError("Not found", { status: 404, code: "NOT_FOUND" });
    }

    let hasAccess = document.access === "PUBLIC";

    if (!hasAccess && userId) {
      const user = await prisma.user.findUnique({
        where: { clerkId: userId },
        select: { id: true },
      });

      if (user) {
        const permission = await prisma.permission.findFirst({
          where: {
            documentId: document.id,
            userId: user.id,
          },
          select: { id: true },
        });

        hasAccess = Boolean(permission || document.ownerId === user.id);
      }
    }

    if (!hasAccess && token) {
      const shareLink = await prisma.shareLink.findFirst({
        where: {
          documentId: document.id,
          token,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true },
      });

      hasAccess = Boolean(shareLink);
    }

    return apiSuccess({ access: hasAccess });
  } catch (error) {
    return handleApiError(error);
  }
}
