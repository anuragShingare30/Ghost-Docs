"use client";

import { CollaborationIdentity } from "../types";

const STORAGE_KEY = "ghostdocs:collab:identity";

type StoredIdentity = {
  peerPrivateKey: string;
  peerId: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function getOrCreatePeerIdentity() {
  const { generateKeyPair, privateKeyToProtobuf, privateKeyFromProtobuf } =
    await import("@libp2p/crypto/keys");

  const cached = window.localStorage.getItem(STORAGE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached) as StoredIdentity;
    const privateKey = privateKeyFromProtobuf(base64ToBytes(parsed.peerPrivateKey));
    const derivedPeerId = privateKey.publicKey.toCID().toString();

    if (derivedPeerId !== parsed.peerId) {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          peerId: derivedPeerId,
          peerPrivateKey: parsed.peerPrivateKey,
        } satisfies StoredIdentity)
      );
    }

    return {
      peerId: derivedPeerId,
      privateKey,
    };
  }

  const privateKey = await generateKeyPair("Ed25519");
  const peerId = privateKey.publicKey.toCID().toString();
  const encodedPrivateKey = bytesToBase64(privateKeyToProtobuf(privateKey));

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      peerId,
      peerPrivateKey: encodedPrivateKey,
    } satisfies StoredIdentity)
  );

  return { peerId, privateKey };
}

export async function buildCollaborationIdentity(ghostId: string, username?: string) {
  const peerIdentity = await getOrCreatePeerIdentity();

  const identity: CollaborationIdentity = {
    ghostId,
    peerId: peerIdentity.peerId,
    username,
  };

  return { identity, privateKey: peerIdentity.privateKey };
}
