import crypto from "crypto";
import { auth } from "@clerk/nextjs/server";
import {
  apiError,
  apiSuccess,
  handleApiError,
  parseRequestJson,
  unauthorizedError,
} from "../../lib/api";
import { prisma } from "../../lib/prisma";
import { enforceRateLimit } from "../../lib/rate-limit";

type ShareLinkPayload = {
  documentId?: string;
  accessLevel?: "VIEWER" | "EDITOR";
  expiresAt?: string;
};

export async function POST(request: Request) {
  try {
    const rateLimited = enforceRateLimit({
      request,
      keyPrefix: "share-link-create",
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) {
      return rateLimited;
    }

    const { userId } = await auth();

    if (!userId) {
      return unauthorizedError();
    }

    const payload = await parseRequestJson<ShareLinkPayload>(request);
    const documentId = payload.documentId?.trim();

    if (!documentId) {
      return apiError("Document ID is required.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const accessLevel = payload.accessLevel ?? "VIEWER";
    if (accessLevel !== "VIEWER" && accessLevel !== "EDITOR") {
      return apiError("Invalid access level.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return apiError("Invalid expiresAt.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });

    if (!user) {
      return apiError("User not found.", { status: 404, code: "NOT_FOUND" });
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, ownerId: true },
    });

    if (!document || document.ownerId !== user.id) {
      return apiError("Forbidden", { status: 403, code: "FORBIDDEN" });
    }

    const token = crypto.randomBytes(16).toString("hex");

    const shareLink = await prisma.shareLink.create({
      data: {
        documentId,
        token,
        accessLevel,
        expiresAt,
        createdById: user.id,
      },
      select: {
        id: true,
        token: true,
        accessLevel: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    await prisma.auditEvent.create({
      data: {
        documentId,
        actorId: user.id,
        eventType: "LINK_CREATED",
        metadata: { accessLevel },
      },
    });

    return apiSuccess({ shareLink }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
