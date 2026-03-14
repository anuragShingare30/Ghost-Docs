"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

type GhostIdResponse = {
  success: boolean;
  data?: {
    ghostId: string | null;
  };
  error?: {
    message: string;
  };
};

type WalletLinkResponse = {
  success: boolean;
  data?: {
    ghostId: string;
    walletAddress: string;
  };
  error?: {
    message: string;
  };
};

export default function IdentityActions() {
  const { address, isConnected } = useAccount();
  const [ghostId, setGhostId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    let isMounted = true;

    setIsMounted(true);

    async function loadGhostId() {
      try {
        const response = await fetch("/api/ghostid");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as GhostIdResponse;
        if (isMounted) {
          setGhostId(data.data?.ghostId ?? null);
        }
      } catch {
        // Ignore initial load failures in UI-only action.
      }
    }

    loadGhostId();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleCreateGhostId() {
    setIsLoading(true);
    setStatus(null);
    try {
      const response = await fetch("/api/ghostid", { method: "POST" });
      const data = (await response.json()) as GhostIdResponse;
      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to create GhostID.");
      }
      setGhostId(data.data?.ghostId ?? null);
      setStatus("GhostID created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLinkWallet() {
    if (!address) {
      setStatus("Connect a wallet first.");
      return;
    }

    setIsLoading(true);
    setStatus(null);
    try {
      const response = await fetch("/api/wallet-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address }),
      });

      const data = (await response.json()) as WalletLinkResponse;
      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to link wallet.");
      }

      setGhostId(data.data?.ghostId ?? null);
      setStatus("Wallet linked.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleCreateGhostId}
          disabled={isLoading}
          className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {ghostId ? "Refresh GhostID" : "Create GhostID"}
        </button>
        <button
          type="button"
          onClick={handleLinkWallet}
          disabled={!isMounted || isLoading || !isConnected}
          className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-neutral-100 transition hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isMounted ? "Link wallet" : "Loading..."}
        </button>
      </div>
      <div className="text-sm text-neutral-400">
        {ghostId ? `GhostID: ${ghostId}` : "GhostID not created yet."}
      </div>
      {status ? <p className="text-sm text-neutral-300">{status}</p> : null}
    </div>
  );
}
