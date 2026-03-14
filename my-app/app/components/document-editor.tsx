"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDocumentCollaboration } from "../lib/collaboration/use-document-collaboration";

type ApiSuccess<T> = {
  success: true;
  version: string;
  data: T;
};

type ApiFailure = {
  success: false;
  version: string;
  error: {
    message: string;
    code?: string;
  };
};

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

type MetadataPayload = {
  document: {
    id: string;
    title: string;
    access: "PRIVATE" | "LINK" | "PUBLIC";
  };
};

type ContentPayload = {
  fileverseDdocId: string | null;
  content: string | null;
  legacyContentNeedsResave?: boolean;
  syncStatus: "pending" | "synced" | "failed" | null;
  link: string | null;
  localVersion: number | null;
  onchainVersion: number | null;
  updatedAt?: string | null;
};

function getErrorMessage<T>(response: ApiResponse<T>) {
  if (!response.success) {
    return response.error.message;
  }
  return "Unexpected response.";
}

type DocumentEditorProps = {
  documentId: string;
};

export default function DocumentEditor({ documentId }: DocumentEditorProps) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || undefined;

  const [title, setTitle] = useState("Untitled document");
  const [access, setAccess] = useState<"PRIVATE" | "LINK" | "PUBLIC" | null>(
    null
  );
  const [content, setContent] = useState("");
  const [syncStatus, setSyncStatus] = useState<string>("Not saved");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fileverseLink, setFileverseLink] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");

  const metadataUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (token) {
      params.set("token", token);
    }
    const query = params.toString();
    return query
      ? `/api/documents/${documentId}/metadata?${query}`
      : `/api/documents/${documentId}/metadata`;
  }, [documentId, token]);

  const contentUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (token) {
      params.set("token", token);
    }
    const query = params.toString();
    return query
      ? `/api/documents/${documentId}/content?${query}`
      : `/api/documents/${documentId}/content`;
  }, [documentId, token]);

  async function loadDocument() {
    setIsLoading(true);
    setMessage(null);

    try {
      const [metadataRes, contentRes] = await Promise.all([
        fetch(metadataUrl, { cache: "no-store" }),
        fetch(contentUrl, { cache: "no-store" }),
      ]);

      const metadata = (await metadataRes.json()) as ApiResponse<MetadataPayload>;
      if (!metadataRes.ok || !metadata.success) {
        throw new Error(getErrorMessage(metadata));
      }

      const contentPayload = (await contentRes.json()) as ApiResponse<ContentPayload>;
      if (!contentRes.ok || !contentPayload.success) {
        throw new Error(getErrorMessage(contentPayload));
      }

      setTitle(metadata.data.document.title);
      setAccess(metadata.data.document.access);

      setContent(contentPayload.data.content || "");

      setSyncStatus(contentPayload.data.syncStatus || "Not saved");
      setFileverseLink(contentPayload.data.link || null);

      if (contentPayload.data.legacyContentNeedsResave) {
        setMessage(
          "Legacy encrypted content was detected and could not be decrypted on the server. Open from the original browser once and save to migrate for all users."
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to load document content."
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDocument();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadataUrl, contentUrl]);

  async function handleSave() {
    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/documents/${documentId}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, title }),
      });

      const payload = (await response.json()) as ApiResponse<ContentPayload>;
      if (!response.ok || !payload.success) {
        throw new Error(getErrorMessage(payload));
      }

      setSyncStatus(payload.data.syncStatus || "pending");
      setFileverseLink(payload.data.link || null);
      setMessage("Saved document content.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to save document."
      );
    } finally {
      setIsSaving(false);
    }
  }

  const collaboration = useDocumentCollaboration({
    documentId,
    enabled: !isLoading,
    initialContent: content,
    onRemoteContentChange: (nextValue) => {
      setContent(nextValue);
    },
  });

  async function handleChatSend() {
    const value = chatInput.trim();
    if (!value) {
      return;
    }
    await collaboration.sendChat(value);
    setChatInput("");
  }

  if (isLoading) {
    return <p className="text-sm text-neutral-400">Loading document...</p>;
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Encrypted Editor</h2>
          <p className="text-sm text-neutral-400">
            Access: {access ?? "unknown"} · Sync status: {syncStatus}
          </p>
          <p className="text-xs text-neutral-500">
            Collaboration: {collaboration.status}
            {collaboration.role ? ` (${collaboration.role})` : ""}
            {collaboration.error ? ` · ${collaboration.error}` : ""}
          </p>
          <p className="text-xs text-neutral-500">
            Local peer: {collaboration.localPeerId || "pending"} · libp2p connections: {" "}
            {collaboration.connectionCount}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadDocument()}
            className="rounded-md border border-neutral-700 px-3 py-2 text-sm font-semibold"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-md border border-neutral-700 px-3 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="doc-title" className="text-xs uppercase tracking-wider text-neutral-400">
          Title
        </label>
        <input
          id="doc-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
        />
      </div>

      <div className="mt-4">
        <label htmlFor="doc-content" className="text-xs uppercase tracking-wider text-neutral-400">
          Content
        </label>
        <textarea
          id="doc-content"
          value={content}
          onChange={(event) => {
            const nextValue = event.target.value;
            setContent(nextValue);
            void collaboration.onLocalContentChange(nextValue);
            void collaboration.onCursorChange(event.target.selectionStart ?? 0);
          }}
          className="mt-1 min-h-80 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
          <p className="text-xs uppercase tracking-wider text-neutral-400">
            Active peers ({collaboration.peers.length})
          </p>
          {collaboration.peers.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">No peers connected.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-neutral-300">
              {collaboration.peers.map((peer) => (
                <li key={peer.peerId}>
                  {peer.ghostId} · {peer.role}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
          <p className="text-xs uppercase tracking-wider text-neutral-400">Session chat</p>
          <div className="mt-2 max-h-32 space-y-1 overflow-y-auto text-sm text-neutral-300">
            {collaboration.messages.length === 0 ? (
              <p className="text-neutral-500">No chat messages yet.</p>
            ) : (
              collaboration.messages.map((entry, index) => (
                <p key={`${entry.peerId}-${entry.timestamp}-${index}`}>
                  <span className="text-neutral-500">{entry.ghostId}:</span> {entry.text}
                </p>
              ))
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Send a message"
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
            />
            <button
              type="button"
              onClick={() => void handleChatSend()}
              className="rounded-md border border-neutral-700 px-3 py-2 text-sm font-semibold"
            >
              Send
            </button>
          </div>
        </div>
      </div>

      {fileverseLink ? (
        <p className="mt-3 text-xs text-neutral-400">
          Fileverse link: <a className="underline" href={fileverseLink} target="_blank" rel="noreferrer">{fileverseLink}</a>
        </p>
      ) : null}

      {message ? <p className="mt-3 text-sm text-neutral-300">{message}</p> : null}
    </section>
  );
}
