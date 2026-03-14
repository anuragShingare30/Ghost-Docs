"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type AccessMode = "PRIVATE" | "LINK" | "PUBLIC";

type DocumentItem = {
  id: string;
  title: string;
  access: AccessMode;
  createdAt: string;
  updatedAt: string;
};

type ApiSuccess<T> = {
  success: true;
  version: string;
  data: T;
  meta?: Record<string, unknown>;
};

type ApiError = {
  success: false;
  version: string;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
};

type ApiResponse<T> = ApiSuccess<T> | ApiError;

type DocumentListResponse = {
  documents: DocumentItem[];
};

type CreateDocumentResponse = {
  document: DocumentItem;
};

type ShareLinkResponse = {
  shareLink: {
    id: string;
    token: string;
    accessLevel: "VIEWER" | "EDITOR";
    expiresAt: string | null;
    createdAt: string;
  };
};

type AccessCheckResponse = {
  access: boolean;
};

type MetadataResponse = {
  document: {
    id: string;
    title: string;
    access: AccessMode;
    ownerGhostId: string;
    createdAt: string;
    updatedAt: string;
  };
};

type ListMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  access: string | null;
  query: string | null;
};

const defaultMeta: ListMeta = {
  page: 1,
  pageSize: 6,
  total: 0,
  totalPages: 0,
  access: null,
  query: null,
};

function getErrorMessage<T>(result: ApiResponse<T>) {
  if (!result.success) {
    return result.error.message;
  }
  return "Unexpected error.";
}

function getTokenFromShareUrl(url: string | undefined) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("token");
  } catch {
    return null;
  }
}

export default function DashboardDocuments() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [meta, setMeta] = useState<ListMeta>(defaultMeta);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [access, setAccess] = useState<AccessMode | "ALL">("ALL");
  const [createAccess, setCreateAccess] = useState<AccessMode>("PRIVATE");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [shareLinks, setShareLinks] = useState<Record<string, string>>({});
  const [rowMessages, setRowMessages] = useState<Record<string, string>>({});

  const canGoPrevious = useMemo(() => meta.page > 1, [meta.page]);
  const canGoNext = useMemo(() => meta.page < meta.totalPages, [meta]);

  async function loadDocuments(page = 1) {
    setIsLoading(true);
    setStatus(null);

    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(meta.pageSize),
      });

      if (access !== "ALL") {
        params.set("access", access);
      }
      if (query.trim()) {
        params.set("query", query.trim());
      }

      const response = await fetch(`/api/documents?${params.toString()}`);
      const result = (await response.json()) as ApiResponse<DocumentListResponse>;

      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result));
      }

      setDocuments(result.data.documents);
      setMeta((prev) => ({
        ...prev,
        page: Number(result.meta?.page ?? page),
        pageSize: Number(result.meta?.pageSize ?? prev.pageSize),
        total: Number(result.meta?.total ?? 0),
        totalPages: Number(result.meta?.totalPages ?? 0),
        access: (result.meta?.access as string | null) ?? null,
        query: (result.meta?.query as string | null) ?? null,
      }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load documents.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDocuments(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, query]);

  async function handleCreateDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim()) {
      setStatus("Document title is required.");
      return;
    }

    setIsLoading(true);
    setStatus(null);

    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), access: createAccess }),
      });

      const result = (await response.json()) as ApiResponse<CreateDocumentResponse>;
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result));
      }

      setTitle("");
      setStatus("Document created.");
      await loadDocuments(1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create document.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateShareLink(documentId: string) {
    setRowMessages((prev) => ({ ...prev, [documentId]: "Creating share link..." }));

    try {
      const response = await fetch("/api/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, accessLevel: "VIEWER" }),
      });

      const result = (await response.json()) as ApiResponse<ShareLinkResponse>;
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result));
      }

      const shareUrl = `${window.location.origin}/editor/${documentId}?token=${result.data.shareLink.token}`;
      setShareLinks((prev) => ({ ...prev, [documentId]: shareUrl }));
      setRowMessages((prev) => ({ ...prev, [documentId]: "Share link ready." }));
    } catch (error) {
      setRowMessages((prev) => ({
        ...prev,
        [documentId]: error instanceof Error ? error.message : "Failed to create share link.",
      }));
    }
  }

  async function handleCheckAccess(documentId: string) {
    setRowMessages((prev) => ({ ...prev, [documentId]: "Checking access..." }));

    try {
      const response = await fetch(`/api/documents/${documentId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const result = (await response.json()) as ApiResponse<AccessCheckResponse>;
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result));
      }

      setRowMessages((prev) => ({
        ...prev,
        [documentId]: result.data.access ? "Access allowed." : "Access denied.",
      }));
    } catch (error) {
      setRowMessages((prev) => ({
        ...prev,
        [documentId]: error instanceof Error ? error.message : "Access check failed.",
      }));
    }
  }

  async function handleLoadMetadata(documentId: string) {
    setRowMessages((prev) => ({ ...prev, [documentId]: "Loading metadata..." }));

    try {
      const response = await fetch(`/api/documents/${documentId}/metadata`);
      const result = (await response.json()) as ApiResponse<MetadataResponse>;

      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result));
      }

      setRowMessages((prev) => ({
        ...prev,
        [documentId]: `Metadata loaded for ${result.data.document.title}.`,
      }));
    } catch (error) {
      setRowMessages((prev) => ({
        ...prev,
        [documentId]: error instanceof Error ? error.message : "Metadata fetch failed.",
      }));
    }
  }

  async function copyLink(documentId: string) {
    const link = shareLinks[documentId];
    if (!link) {
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      setRowMessages((prev) => ({ ...prev, [documentId]: "Share link copied." }));
    } catch {
      setRowMessages((prev) => ({ ...prev, [documentId]: "Failed to copy link." }));
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Documents</h2>
        <p className="text-sm text-neutral-400">
          Phase 2 dashboard actions: create documents, filter/paginate list, create share links, and run access/metadata checks.
        </p>
        <p className="text-xs text-neutral-500">
          Collaboration is live in editor sessions. Use &quot;Open collaboration&quot; for a direct collab entry, and create share links for token-based participants.
        </p>
      </div>

      <form onSubmit={handleCreateDocument} className="mt-6 grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New document title"
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        <select
          value={createAccess}
          onChange={(event) => setCreateAccess(event.target.value as AccessMode)}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        >
          <option value="PRIVATE">PRIVATE</option>
          <option value="LINK">LINK</option>
          <option value="PUBLIC">PUBLIC</option>
        </select>
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-neutral-500 disabled:opacity-60"
        >
          Create document
        </button>
      </form>

      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <input
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder="Search title"
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        <select
          value={access}
          onChange={(event) => setAccess(event.target.value as AccessMode | "ALL")}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        >
          <option value="ALL">ALL</option>
          <option value="PRIVATE">PRIVATE</option>
          <option value="LINK">LINK</option>
          <option value="PUBLIC">PUBLIC</option>
        </select>
        <button
          type="button"
          onClick={() => setQuery(queryInput.trim())}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-neutral-500"
        >
          Apply filters
        </button>
      </div>

      {status ? <p className="mt-4 text-sm text-neutral-300">{status}</p> : null}

      <div className="mt-6 space-y-3">
        {documents.length === 0 ? (
          <p className="text-sm text-neutral-400">No documents found.</p>
        ) : (
          documents.map((document) => (
            <article key={document.id} className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
              {(() => {
                const sharedUrl = shareLinks[document.id];
                const token = getTokenFromShareUrl(sharedUrl);
                const collaborationHref = token
                  ? `/editor/${document.id}?token=${token}`
                  : `/editor/${document.id}`;

                return (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-neutral-100">{document.title}</p>
                  <p className="text-xs text-neutral-400">
                    {document.access} · Updated {new Date(document.updatedAt).toLocaleString()}
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Collaboration route: {token ? "token-based" : "authenticated"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/editor/${document.id}`}
                    className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-100 transition hover:border-neutral-500"
                  >
                    Open editor
                  </Link>
                  <Link
                    href={collaborationHref}
                    className="rounded-md border border-emerald-700/70 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:border-emerald-500"
                  >
                    Open collaboration
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleCreateShareLink(document.id)}
                    className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-100 transition hover:border-neutral-500"
                  >
                    Share link
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCheckAccess(document.id)}
                    className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-100 transition hover:border-neutral-500"
                  >
                    Check access
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadMetadata(document.id)}
                    className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-100 transition hover:border-neutral-500"
                  >
                    Fetch metadata
                  </button>
                </div>
              </div>
                );
              })()}

              {shareLinks[document.id] ? (
                <div className="mt-3 flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/70 px-3 py-2">
                  <p className="truncate text-xs text-neutral-300">{shareLinks[document.id]}</p>
                  <button
                    type="button"
                    onClick={() => copyLink(document.id)}
                    className="rounded-md border border-neutral-700 px-2 py-1 text-[11px] font-semibold text-neutral-100"
                  >
                    Copy
                  </button>
                </div>
              ) : null}

              {rowMessages[document.id] ? (
                <p className="mt-2 text-xs text-neutral-400">{rowMessages[document.id]}</p>
              ) : null}
            </article>
          ))
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          Page {meta.page} of {Math.max(meta.totalPages, 1)} · Total {meta.total}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!canGoPrevious || isLoading}
            onClick={() => loadDocuments(meta.page - 1)}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-100 disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!canGoNext || isLoading}
            onClick={() => loadDocuments(meta.page + 1)}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-100 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
