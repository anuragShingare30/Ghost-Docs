    import { auth } from "@clerk/nextjs/server";
import {
  apiError,
  apiSuccess,
  handleApiError,
  parseRequestJson,
  unauthorizedError,
} from "../../../../lib/api";
import { hasDocumentAccess } from "../../../../lib/access";
import { prisma } from "../../../../lib/prisma";
import { storageAdapter } from "../../../../lib/storage";
import {
  decryptStoredContent,
  encryptStoredContent,
  isStructuredEncryptedPayload,
} from "../../../../lib/crypto/server-content-crypto";

type UpsertContentPayload = {
  content?: string;
  title?: string;
};

function toStorageUri(ddocId: string) {
  return `fileverse:${ddocId}`;
}

function parseStorageUri(storageUri: string) {
  if (storageUri.startsWith("fileverse:")) {
    return storageUri.replace("fileverse:", "");
  }
  return storageUri;
}

async function getLatestVersion(documentId: string) {
  return prisma.documentVersion.findFirst({
    where: { documentId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      storageUri: true,
      createdAt: true,
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || undefined;

    const access = await hasDocumentAccess({
      documentId: id,
      userId,
      token,
    });

    if (!access.document) {
      return apiError("Document not found.", { status: 404, code: "NOT_FOUND" });
    }

    if (!access.hasAccess) {
      return apiError("Forbidden", { status: 403, code: "FORBIDDEN" });
    }

    const latestVersion = await getLatestVersion(id);
    if (!latestVersion) {
      return apiSuccess({
        fileverseDdocId: null,
        content: null,
        legacyContentNeedsResave: false,
        syncStatus: null,
        link: null,
        localVersion: null,
        onchainVersion: null,
      });
    }

    const ddocId = parseStorageUri(latestVersion.storageUri);
    const fileverseDocument = await storageAdapter.getDoc(ddocId);
    let content = "";
    let legacyContentNeedsResave = false;

    if (fileverseDocument.content) {
      try {
        content = decryptStoredContent(id, fileverseDocument.content);
      } catch {
        // Legacy client-encrypted payloads cannot be decrypted server-side.
        if (isStructuredEncryptedPayload(fileverseDocument.content)) {
          content = "";
          legacyContentNeedsResave = true;
        } else {
          // Backward compatibility for plain-text historical entries.
          content = fileverseDocument.content;
        }
      }
    }

    return apiSuccess({
      fileverseDdocId: ddocId,
      content,
      legacyContentNeedsResave,
      syncStatus: fileverseDocument.syncStatus ?? null,
      link: fileverseDocument.link ?? null,
      localVersion: fileverseDocument.localVersion ?? null,
      onchainVersion: fileverseDocument.onchainVersion ?? null,
      updatedAt: fileverseDocument.updatedAt ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();

    if (!userId) {
      return unauthorizedError();
    }

    const payload = await parseRequestJson<UpsertContentPayload>(request);
    const content = payload.content;

    if (typeof content !== "string") {
      return apiError("Document content is required.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const encryptedContent = encryptStoredContent(id, content);

    const access = await hasDocumentAccess({
      documentId: id,
      userId,
    });

    if (!access.document) {
      return apiError("Document not found.", { status: 404, code: "NOT_FOUND" });
    }

    if (!access.hasAccess) {
      return apiError("Forbidden", { status: 403, code: "FORBIDDEN" });
    }

    const actor = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });

    if (!actor) {
      return apiError("User not found.", { status: 404, code: "NOT_FOUND" });
    }

    const document = await prisma.document.findUnique({
      where: { id },
      select: { id: true, title: true },
    });

    if (!document) {
      return apiError("Document not found.", { status: 404, code: "NOT_FOUND" });
    }

    const latestVersion = await getLatestVersion(id);
    const existingDdocId = latestVersion
      ? parseStorageUri(latestVersion.storageUri)
      : null;

    const storageResult = existingDdocId
      ? await storageAdapter.updateDoc(
          existingDdocId,
          encryptedContent,
          payload.title?.trim() || undefined
        )
      : await storageAdapter.createDoc(
          payload.title?.trim() || document.title,
          encryptedContent
        );

    const version = await prisma.documentVersion.create({
      data: {
        documentId: id,
        storageUri: toStorageUri(storageResult.ddocId),
        createdById: actor.id,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    if (payload.title?.trim()) {
      await prisma.document.update({
        where: { id },
        data: { title: payload.title.trim() },
      });
    }

    return apiSuccess({
      versionId: version.id,
      fileverseDdocId: storageResult.ddocId,
      syncStatus: storageResult.syncStatus ?? null,
      link: storageResult.link ?? null,
      localVersion: storageResult.localVersion ?? null,
      onchainVersion: storageResult.onchainVersion ?? null,
      updatedAt: storageResult.updatedAt ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();

    if (!userId) {
      return unauthorizedError();
    }

    const actor = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });

    if (!actor) {
      return apiError("User not found.", { status: 404, code: "NOT_FOUND" });
    }

    const document = await prisma.document.findUnique({
      where: { id },
      select: { ownerId: true },
    });

    if (!document) {
      return apiError("Document not found.", { status: 404, code: "NOT_FOUND" });
    }

    if (document.ownerId !== actor.id) {
      return apiError("Only document owner can delete storage record.", {
        status: 403,
        code: "FORBIDDEN",
      });
    }

    const latestVersion = await getLatestVersion(id);
    if (!latestVersion) {
      return apiSuccess({ deleted: false, message: "No storage record found." });
    }

    const ddocId = parseStorageUri(latestVersion.storageUri);
    await storageAdapter.deleteDoc(ddocId);

    return apiSuccess({ deleted: true, fileverseDdocId: ddocId });
  } catch (error) {
    return handleApiError(error);
  }
}
