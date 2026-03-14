import { auth } from "@clerk/nextjs/server";
import {
  apiError,
  apiSuccess,
  handleApiError,
  parseRequestJson,
  unauthorizedError,
} from "../../../lib/api";
import { prisma } from "../../../lib/prisma";
import {
  createCollaborationSessionKey,
  createCollaborationToken,
} from "../../../lib/collaboration/server-token";
import type { CollaborationRole } from "../../../lib/collaboration/types";

type JoinPayload = {
  docId?: string;
  peerId?: string;
  accessToken?: string;
  ghostId?: string;
};

type ActivePeerEntry = {
  peerId: string;
  lastSeenAt: number;
};

const ACTIVE_PEER_TTL_MS = 10 * 60_000;
const activePeersByDoc = new Map<string, Map<string, ActivePeerEntry>>();

function upsertActivePeer(docId: string, peerId: string) {
  const now = Date.now();
  let docPeers = activePeersByDoc.get(docId);
  if (!docPeers) {
    docPeers = new Map<string, ActivePeerEntry>();
    activePeersByDoc.set(docId, docPeers);
  }

  for (const [existingPeerId, entry] of docPeers.entries()) {
    if (now - entry.lastSeenAt > ACTIVE_PEER_TTL_MS) {
      docPeers.delete(existingPeerId);
    }
  }

  docPeers.set(peerId, {
    peerId,
    lastSeenAt: now,
  });

  return Array.from(docPeers.values())
    .map((entry) => entry.peerId)
    .filter((existingPeerId) => existingPeerId !== peerId);
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    const body = await parseRequestJson<JoinPayload>(request);
    const docId = body.docId?.trim();
    const peerId = body.peerId?.trim();
    const accessToken = body.accessToken?.trim();
    const providedGhostId = body.ghostId?.trim();

    if (!docId || !peerId) {
      return apiError("docId and peerId are required.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    if (!userId && !accessToken) {
      return unauthorizedError();
    }

    const user = userId
      ? await prisma.user.findUnique({
          where: { clerkId: userId },
          select: { id: true, ghostId: true },
        })
      : null;

    if (userId && !user) {
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

    if (user && document.ownerId === user.id) {
      role = "OWNER";
    }

    if (!role && user) {
      const permission = await prisma.permission.findFirst({
        where: { documentId: docId, userId: user.id },
        select: { role: true },
      });

      role = permission?.role ?? null;
    }

    if (!role && accessToken) {
      const shareLink = await prisma.shareLink.findFirst({
        where: {
          documentId: docId,
          token: accessToken,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { accessLevel: true },
      });

      if (shareLink) {
        role = shareLink.accessLevel === "EDITOR" ? "EDITOR" : "VIEWER";
      }
    }

    if (!role && document.access === "PUBLIC") {
      role = "VIEWER";
    }

    if (!role) {
      return apiError("Forbidden", { status: 403, code: "FORBIDDEN" });
    }

    const tokenGhostId = user?.ghostId ?? providedGhostId;
    if (!tokenGhostId) {
      return apiError("ghostId is required for anonymous collaboration join.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const token = createCollaborationToken({
      docId,
      ghostId: tokenGhostId,
      role,
      peerId,
      ttlSeconds: 30 * 60,
    });

    const sessionKey = createCollaborationSessionKey(docId);
    const peerHints = upsertActivePeer(docId, peerId);

    return apiSuccess({ token, sessionKey, docId, role, peerHints });
  } catch (error) {
    return handleApiError(error);
  }
}
