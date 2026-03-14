import { auth } from "@clerk/nextjs/server";
import {
  apiError,
  apiSuccess,
  handleApiError,
  parseRequestJson,
  unauthorizedError,
} from "../../../lib/api";
import { prisma } from "../../../lib/prisma";
import { createCollaborationToken } from "../../../lib/collaboration/server-token";
import type { CollaborationRole } from "../../../lib/collaboration/types";

type JoinPayload = {
  docId?: string;
  peerId?: string;
};

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return unauthorizedError();
    }

    const body = await parseRequestJson<JoinPayload>(request);
    const docId = body.docId?.trim();
    const peerId = body.peerId?.trim();

    if (!docId || !peerId) {
      return apiError("docId and peerId are required.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, ghostId: true },
    });

    if (!user) {
      return apiError("User not found.", { status: 404, code: "NOT_FOUND" });
    }

    const document = await prisma.document.findUnique({
      where: { id: docId },
      select: { ownerId: true, access: true },
    });

    if (!document) {
      return apiError("Document not found.", { status: 404, code: "NOT_FOUND" });
    }

    let role: CollaborationRole | null = null;

    if (document.ownerId === user.id) {
      role = "OWNER";
    }

    if (!role) {
      const permission = await prisma.permission.findFirst({
        where: { documentId: docId, userId: user.id },
        select: { role: true },
      });

      role = permission?.role ?? null;
    }

    if (!role && document.access === "PUBLIC") {
      role = "VIEWER";
    }

    if (!role) {
      return apiError("Forbidden", { status: 403, code: "FORBIDDEN" });
    }

    const token = createCollaborationToken({
      docId,
      ghostId: user.ghostId,
      role,
      peerId,
      ttlSeconds: 30 * 60,
    });

    return apiSuccess({ token, docId, role });
  } catch (error) {
    return handleApiError(error);
  }
}
