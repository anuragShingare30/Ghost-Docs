"use client";

import { CollaborationRole } from "../types";

type JoinResponse = {
  token: string;
  docId: string;
  role: CollaborationRole;
};

type VerifyResponse = {
  valid: boolean;
  role?: CollaborationRole;
};

export async function requestCollabJoinToken(docId: string, peerId: string) {
  const response = await fetch("/api/collab/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId, peerId }),
  });

  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message || "Failed to join collaboration session.");
  }

  return payload.data as JoinResponse;
}

export async function verifyCollabToken(options: {
  token: string;
  docId: string;
  peerId: string;
  ghostId: string;
}) {
  const response = await fetch("/api/collab/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });

  const payload = await response.json();
  if (!response.ok || !payload.success) {
    return { valid: false } as VerifyResponse;
  }

  return payload.data as VerifyResponse;
}
