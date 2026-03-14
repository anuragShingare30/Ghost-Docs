"use client";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type SerializedCipherPayload = {
  v: 1;
  iv: string;
  cipher: string;
};

function bytesToBase64(bytes: Uint8Array) {
  if (typeof window === "undefined") {
    throw new Error("Encryption helpers can only run in the browser.");
  }

  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function base64ToBytes(base64: string) {
  if (typeof window === "undefined") {
    throw new Error("Encryption helpers can only run in the browser.");
  }

  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function keyStorageName(documentId: string) {
  return `ghostdocs:aes:${documentId}`;
}

async function importStoredKey(documentId: string) {
  if (typeof window === "undefined") {
    throw new Error("Encryption helpers can only run in the browser.");
  }

  const raw = window.localStorage.getItem(keyStorageName(documentId));
  if (!raw) {
    return null;
  }

  const jwk = JSON.parse(raw) as JsonWebKey;
  return crypto.subtle.importKey("jwk", jwk, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
}

async function createAndStoreKey(documentId: string) {
  if (typeof window === "undefined") {
    throw new Error("Encryption helpers can only run in the browser.");
  }

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const jwk = await crypto.subtle.exportKey("jwk", key);
  window.localStorage.setItem(keyStorageName(documentId), JSON.stringify(jwk));

  return key;
}

async function getOrCreateKey(documentId: string) {
  const existing = await importStoredKey(documentId);
  if (existing) {
    return existing;
  }
  return createAndStoreKey(documentId);
}

export async function encryptDocumentContent(documentId: string, content: string) {
  const key = await getOrCreateKey(documentId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(content)
  );

  const payload: SerializedCipherPayload = {
    v: 1,
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(encrypted)),
  };

  return JSON.stringify(payload);
}

export async function decryptDocumentContent(documentId: string, encryptedContent: string) {
  const key = await importStoredKey(documentId);
  if (!key) {
    throw new Error("No local decryption key found for this document.");
  }

  const payload = JSON.parse(encryptedContent) as SerializedCipherPayload;
  if (payload.v !== 1 || !payload.iv || !payload.cipher) {
    throw new Error("Invalid encrypted payload format.");
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.cipher)
  );

  return decoder.decode(decrypted);
}
