import { auth } from "@clerk/nextjs/server";
import { apiError, apiSuccess, handleApiError } from "../../../../lib/api";
import { prisma } from "../../../../lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const url = new URL(request.url);
    const token = url.searchParams.get("token") || undefined;
    const { userId } = await auth();

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        owner: { select: { ghostId: true } },
      },
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

    if (!hasAccess && document.access === "LINK" && !token) {
      return apiError("Link required", { status: 403, code: "FORBIDDEN" });
    }

    if (!hasAccess) {
      return apiError("Forbidden", { status: 403, code: "FORBIDDEN" });
    }

    return apiSuccess({
      document: {
        id: document.id,
        title: document.title,
        access: document.access,
        ownerGhostId: document.owner.ghostId,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
