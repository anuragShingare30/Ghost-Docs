import { prisma } from "./prisma";

export async function getUserByClerkId(clerkId: string) {
  try {
    return await prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, ghostId: true },
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to load user."
    );
  }
}

export async function hasDocumentAccess(options: {
  documentId: string;
  userId?: string | null;
  token?: string | null;
}) {
  try {
    const document = await prisma.document.findUnique({
      where: { id: options.documentId },
      select: { id: true, access: true, ownerId: true },
    });

    if (!document) {
      return { document: null, hasAccess: false };
    }

    if (document.access === "PUBLIC") {
      return { document, hasAccess: true };
    }

    if (options.userId) {
      const user = await prisma.user.findUnique({
        where: { clerkId: options.userId },
        select: { id: true },
      });

      if (user) {
        const permission = await prisma.permission.findFirst({
          where: { documentId: document.id, userId: user.id },
          select: { id: true },
        });

        if (permission || document.ownerId === user.id) {
          return { document, hasAccess: true };
        }
      }
    }

    if (options.token) {
      const shareLink = await prisma.shareLink.findFirst({
        where: {
          documentId: document.id,
          token: options.token,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true },
      });

      if (shareLink) {
        return { document, hasAccess: true };
      }
    }

    return { document, hasAccess: false };
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to check access."
    );
  }
}
