import "server-only";

import crypto from "crypto";

const CONTENT_SECRET =
  process.env.DOCUMENT_CONTENT_SECRET || process.env.COLLAB_TOKEN_SECRET || "ghostdocs-content-secret";

type CipherPayload = {
  v: 1;
  iv: string;
  tag: string;
  cipher: string;
};

type LegacyCipherPayload = {
  v: 1;
  iv: string;
  cipher: string;
};

function deriveKey(documentId: string) {
  return crypto.scryptSync(CONTENT_SECRET, `ghostdocs-doc:${documentId}`, 32);
}

export function encryptStoredContent(documentId: string, content: string) {
  const iv = crypto.randomBytes(12);
  const key = deriveKey(documentId);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(content, "utf8"),
    cipher.final(),
  ]);

  const payload: CipherPayload = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    cipher: encrypted.toString("base64"),
  };

  return JSON.stringify(payload);
}

export function decryptStoredContent(documentId: string, storedContent: string) {
  const parsed = JSON.parse(storedContent) as Partial<CipherPayload>;

  if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.cipher) {
    throw new Error("Invalid encrypted content payload.");
  }

  const key = deriveKey(documentId);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parsed.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(parsed.cipher, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function isStructuredEncryptedPayload(storedContent: string) {
  try {
    const parsed = JSON.parse(storedContent) as Partial<CipherPayload & LegacyCipherPayload>;
    return (
      parsed.v === 1 &&
      typeof parsed.iv === "string" &&
      typeof parsed.cipher === "string"
    );
  } catch {
    return false;
  }
}
