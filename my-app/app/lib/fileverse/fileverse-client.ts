import "server-only";

type FileverseDoc = {
  ddocId: string;
  title?: string;
  content?: string;
  syncStatus?: "pending" | "synced" | "failed";
  link?: string;
  localVersion?: number;
  onchainVersion?: number;
  isDeleted?: number;
  createdAt?: string;
  updatedAt?: string;
};

type FileverseCreateResponse = {
  message?: string;
  data: FileverseDoc;
};

const FILEVERSE_BASE_URL =
  process.env.FILEVERSE_API_BASE_URL || "http://localhost:8001";
const FILEVERSE_API_KEY = process.env.FILEVERSE_API_KEY;

function withApiKey(path: string) {
  if (!FILEVERSE_API_KEY) {
    throw new Error("Missing FILEVERSE_API_KEY in environment variables.");
  }

  const separator = path.includes("?") ? "&" : "?";
  return `${FILEVERSE_BASE_URL}${path}${separator}apiKey=${encodeURIComponent(FILEVERSE_API_KEY)}`;
}

async function parseFileverseResponse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as { message?: string }).message)
        : `Fileverse request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export async function fileverseCreateDocument(options: {
  title: string;
  content: string;
}) {
  const response = await fetch(withApiKey("/api/ddocs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: options.title, content: options.content }),
    cache: "no-store",
  });

  const data = await parseFileverseResponse<FileverseCreateResponse>(response);
  return data.data;
}

export async function fileverseGetDocument(ddocId: string) {
  const response = await fetch(withApiKey(`/api/ddocs/${ddocId}`), {
    method: "GET",
    cache: "no-store",
  });

  return parseFileverseResponse<FileverseDoc>(response);
}

export async function fileverseUpdateDocument(options: {
  ddocId: string;
  title?: string;
  content?: string;
}) {
  const response = await fetch(withApiKey(`/api/ddocs/${options.ddocId}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: options.title, content: options.content }),
    cache: "no-store",
  });

  return parseFileverseResponse<FileverseDoc | FileverseCreateResponse>(response);
}

export async function fileverseDeleteDocument(ddocId: string) {
  const response = await fetch(withApiKey(`/api/ddocs/${ddocId}`), {
    method: "DELETE",
    cache: "no-store",
  });

  await parseFileverseResponse<unknown>(response);
}
