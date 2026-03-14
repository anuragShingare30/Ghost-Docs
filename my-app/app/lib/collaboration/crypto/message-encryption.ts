"use client";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sessionKeyCache = new Map<string, Promise<CryptoKey>>();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveSessionKey(sessionSecret: string, docId: string) {
  const cacheKey = `${docId}:${sessionSecret}`;
  const existing = sessionKeyCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const derivedKeyPromise = (async () => {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: encoder.encode(`ghostdocs-collab:${docId}`),
        iterations: 100_000,
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  })();

  sessionKeyCache.set(cacheKey, derivedKeyPromise);
  return derivedKeyPromise;
}

type EncryptedCollabPayload = {
  iv: string;
  cipher: string;
};

export async function encryptCollaborationPayload(
  sessionSecret: string,
  docId: string,
  payload: unknown
) {
  const key = await deriveSessionKey(sessionSecret, docId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(payload))
  );

  const encrypted: EncryptedCollabPayload = {
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipherBuffer)),
  };

  return JSON.stringify(encrypted);
}

export async function decryptCollaborationPayload<T>(
  sessionSecret: string,
  docId: string,
  encryptedPayload: string
) {
  const key = await deriveSessionKey(sessionSecret, docId);
  const parsed = JSON.parse(encryptedPayload) as EncryptedCollabPayload;

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(parsed.iv) },
    key,
    base64ToBytes(parsed.cipher)
  );

  return JSON.parse(decoder.decode(decrypted)) as T;
}
