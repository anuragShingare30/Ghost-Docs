"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCollaborationIdentity } from "./identity/identity-manager";
import { createCollaborationNode } from "./libp2p/create-node";
import { requestCollabJoinToken } from "./sessions/access-control";
import { SessionManager } from "./sessions/session-manager";
import { createChatPayload } from "./sync/chat-sync";
import { createCursorPayload } from "./sync/cursor-sync";
import { YjsSync } from "./sync/yjs-sync";
import type {
  CollaborationEnvelope,
  ChatPayload,
  CrdtUpdatePayload,
  SessionPeer,
} from "./types";

type ChatMessage = {
  peerId: string;
  ghostId: string;
  text: string;
  timestamp: number;
};

function parseAddressList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function primeRelayConnections(node: {
  dial?: (target: unknown) => Promise<unknown>;
}) {
  if (!node.dial) {
    return;
  }

  const configuredRelays = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_RELAYS);
  const configuredBootstrap = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_BOOTSTRAP);
  const targets =
    configuredRelays.length > 0
      ? configuredRelays
      : configuredBootstrap.length > 0
      ? configuredBootstrap
      : ["/dnsaddr/bootstrap.libp2p.io"];

  await Promise.all(
    targets.map(async (target) => {
      try {
        await node.dial?.(target);
      } catch {
        // Keep trying other relays/bootstrap peers even if one dial fails.
      }
    })
  );
}

function extractDiscoveredPeer(event: Event) {
  const detail = (
    event as Event & { detail?: { id?: unknown; multiaddrs?: unknown[] } }
  ).detail;
  return detail;
}

async function ensureGhostId() {
  const getResponse = await fetch("/api/ghostid", { cache: "no-store" });
  const getPayload = await getResponse.json();
  const ghostId = getPayload?.data?.ghostId as string | null | undefined;

  if (ghostId) {
    return ghostId;
  }

  const createResponse = await fetch("/api/ghostid", {
    method: "POST",
  });
  const createPayload = await createResponse.json();
  const createdGhostId = createPayload?.data?.ghostId as string | null | undefined;

  if (!createdGhostId) {
    throw new Error("Failed to initialize GhostID for collaboration.");
  }

  return createdGhostId;
}

export function useDocumentCollaboration(options: {
  documentId: string;
  enabled: boolean;
  initialContent: string;
  onRemoteContentChange: (next: string) => void;
}) {
  const { documentId, enabled, initialContent, onRemoteContentChange } = options;
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [role, setRole] = useState<string | null>(null);
  const [peers, setPeers] = useState<SessionPeer[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [connectionCount, setConnectionCount] = useState(0);

  const sessionRef = useRef<SessionManager | null>(null);
  const nodeRef = useRef<{
    dial?: (target: unknown) => Promise<unknown>;
    getConnections?: () => unknown[];
    removeEventListener?: (type: string, listener: (event: Event) => void) => void;
  } | null>(null);
  const peerDiscoveryListenerRef = useRef<((event: Event) => void) | null>(null);
  const peerConnectListenerRef = useRef<((event: Event) => void) | null>(null);
  const peerDisconnectListenerRef = useRef<((event: Event) => void) | null>(null);
  const yjsRef = useRef<YjsSync | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const diagnosticsRef = useRef<number | null>(null);
  const relayRetryRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const initialContentRef = useRef(initialContent);
  const onRemoteContentChangeRef = useRef(onRemoteContentChange);

  useEffect(() => {
    onRemoteContentChangeRef.current = onRemoteContentChange;
  }, [onRemoteContentChange]);

  useEffect(() => {
    if (!initializedRef.current) {
      initialContentRef.current = initialContent;
    }
  }, [initialContent]);

  const stopSession = useCallback(async () => {
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    if (diagnosticsRef.current) {
      window.clearInterval(diagnosticsRef.current);
      diagnosticsRef.current = null;
    }

    if (relayRetryRef.current) {
      window.clearInterval(relayRetryRef.current);
      relayRetryRef.current = null;
    }

    const session = sessionRef.current;
    const node = nodeRef.current;
    const onPeerDiscovery = peerDiscoveryListenerRef.current;
    const onPeerConnect = peerConnectListenerRef.current;
    const onPeerDisconnect = peerDisconnectListenerRef.current;

    if (node && onPeerDiscovery) {
      node.removeEventListener?.("peer:discovery", onPeerDiscovery);
    }
    if (node && onPeerConnect) {
      node.removeEventListener?.("peer:connect", onPeerConnect);
    }
    if (node && onPeerDisconnect) {
      node.removeEventListener?.("peer:disconnect", onPeerDisconnect);
    }

    nodeRef.current = null;
    peerDiscoveryListenerRef.current = null;
    peerConnectListenerRef.current = null;
    peerDisconnectListenerRef.current = null;

    sessionRef.current = null;
    yjsRef.current = null;
    initializedRef.current = false;
    setConnectionCount(0);

    if (session) {
      try {
        await session.shutdown();
      } catch {
        // Ignore close errors on teardown.
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled || initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    let disposed = false;

    const initialize = async () => {
      try {
        setStatus("connecting");
        setError(null);

        const ghostId = await ensureGhostId();
        if (disposed) {
          return;
        }

        const { identity, privateKey } = await buildCollaborationIdentity(ghostId);
        if (disposed) {
          return;
        }

        const join = await requestCollabJoinToken(documentId, identity.peerId);
        if (disposed) {
          return;
        }

        const node = await createCollaborationNode(privateKey);
        await node.start();
        await primeRelayConnections(node);
        nodeRef.current = node;

        const onPeerDiscovery = (event: Event) => {
          const discoveredPeer = extractDiscoveredPeer(event);
          if (!discoveredPeer || !node.dial) {
            return;
          }

          const dialTargets: unknown[] = [];
          if (discoveredPeer.id) {
            dialTargets.push(discoveredPeer.id);
          }
          dialTargets.push(discoveredPeer);
          if (Array.isArray(discoveredPeer.multiaddrs)) {
            dialTargets.push(...discoveredPeer.multiaddrs);
          }

          void (async () => {
            for (const target of dialTargets) {
              try {
                await node.dial?.(target);
                break;
              } catch {
                // Keep trying next discovered target/address variant.
              }
            }
          })();
        };

        const onPeerConnect = () => {
          const nextCount = node.getConnections ? node.getConnections().length : 0;
          setConnectionCount(nextCount);
        };

        const onPeerDisconnect = () => {
          const nextCount = node.getConnections ? node.getConnections().length : 0;
          setConnectionCount(nextCount);
        };

        node.addEventListener?.("peer:discovery", onPeerDiscovery);
        node.addEventListener?.("peer:connect", onPeerConnect);
        node.addEventListener?.("peer:disconnect", onPeerDisconnect);
        peerDiscoveryListenerRef.current = onPeerDiscovery;
        peerConnectListenerRef.current = onPeerConnect;
        peerDisconnectListenerRef.current = onPeerDisconnect;

        setLocalPeerId(node.peerId?.toString?.() || identity.peerId);

        const session = new SessionManager({
          node,
          identity,
          token: join.token,
          role: join.role,
          docId: documentId,
        });

        const yjs = new YjsSync(initialContentRef.current);
        yjsRef.current = yjs;

        session.addEventListener("peer:joined", () => {
          setPeers(session.getPeers());
        });

        session.addEventListener("peer:left", () => {
          setPeers(session.getPeers());
        });

        session.addEventListener("peer:update", () => {
          setPeers(session.getPeers());
        });

        session.addEventListener("message", (event) => {
          const envelope = (event as CustomEvent<CollaborationEnvelope>).detail;

          if (envelope.messageType === "crdt-update") {
            const payload = envelope.payload as CrdtUpdatePayload;
            const sync = yjsRef.current;
            if (!sync) {
              return;
            }

            const update = sync.decodeUpdate(payload.update);
            const nextText = sync.applyRemoteUpdate(update);
            onRemoteContentChangeRef.current(nextText);
          }

          if (envelope.messageType === "chat") {
            const payload = envelope.payload as ChatPayload;
            setMessages((previous) => [
              ...previous,
              {
                peerId: envelope.peerId,
                ghostId: envelope.ghostId,
                text: payload.text,
                timestamp: envelope.timestamp,
              },
            ]);
          }
        });

        await session.join();

        sessionRef.current = session;
        setRole(join.role);
        setStatus("connected");

        heartbeatRef.current = window.setInterval(() => {
          void session.heartbeat();
        }, 20_000);

        diagnosticsRef.current = window.setInterval(() => {
          const nextCount = node.getConnections ? node.getConnections().length : 0;
          setConnectionCount(nextCount);
        }, 4_000);

        relayRetryRef.current = window.setInterval(() => {
          const nextCount = node.getConnections ? node.getConnections().length : 0;
          if (nextCount > 0) {
            return;
          }

          void primeRelayConnections(node);
        }, 15_000);

      } catch (initError) {
        setStatus("error");
        setError(
          initError instanceof Error
            ? initError.message
            : "Failed to initialize collaboration."
        );
      }
    };

    void initialize();

    return () => {
      disposed = true;
      void stopSession();
    };
  }, [documentId, enabled, stopSession]);

  const onLocalContentChange = useCallback(async (nextValue: string) => {
    const session = sessionRef.current;
    const yjs = yjsRef.current;

    if (!session || !yjs || yjs.isApplyingRemote()) {
      return;
    }

    const update = yjs.applyLocalText(nextValue);
    if (!update) {
      return;
    }

    await session.publish("crdt-update", {
      update: yjs.encodeUpdate(update),
    });
  }, []);

  const onCursorChange = useCallback(async (position: number) => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }

    await session.publish("cursor", createCursorPayload(position));
  }, []);

  const sendChat = useCallback(async (text: string) => {
    const session = sessionRef.current;
    if (!session || !text.trim()) {
      return;
    }

    await session.publish("chat", createChatPayload(text.trim()));
  }, []);

  return useMemo(
    () => ({
      status,
      role,
      peers,
      localPeerId,
      connectionCount,
      error,
      messages,
      onLocalContentChange,
      onCursorChange,
      sendChat,
    }),
    [
      status,
      role,
      peers,
      localPeerId,
      connectionCount,
      error,
      messages,
      onLocalContentChange,
      onCursorChange,
      sendChat,
    ]
  );
}