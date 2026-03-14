import "server-only";

import crypto from "crypto";
import { CollaborationRole, CollaborationTokenPayload } from "./types";

const COLLAB_SECRET = process.env.COLLAB_TOKEN_SECRET || "ghostdocs-dev-collab-secret";

function encode(input: string) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function decode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(value: string) {
  return crypto
    .createHmac("sha256", COLLAB_SECRET)
    .update(value)
    .digest("base64url");
}

export function createCollaborationSessionKey(docId: string) {
  // Shared key material for all authorized peers in the same document session.
  return crypto
    .createHmac("sha256", COLLAB_SECRET)
    .update(`session:${docId}`)
    .digest("base64url");
}

export function createCollaborationToken(payload: {
  docId: string;
  ghostId: string;
  role: CollaborationRole;
  peerId: string;
  ttlSeconds?: number;
}) {
  const tokenPayload: CollaborationTokenPayload = {
    docId: payload.docId,
    ghostId: payload.ghostId,
    role: payload.role,
    peerId: payload.peerId,
    exp: Math.floor(Date.now() / 1000) + (payload.ttlSeconds ?? 60 * 60),
  };

  const encodedPayload = encode(JSON.stringify(tokenPayload));
  const signature = sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyCollaborationToken(token: string) {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return { valid: false as const };
  }

  const expectedSignature = sign(encodedPayload);
  if (signature !== expectedSignature) {
    return { valid: false as const };
  }

  const payload = JSON.parse(decode(encodedPayload)) as CollaborationTokenPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false as const };
  }

  return {
    valid: true as const,
    payload,
  };
}
