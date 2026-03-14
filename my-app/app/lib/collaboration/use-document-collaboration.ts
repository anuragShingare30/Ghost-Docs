"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCollaborationIdentity } from "./identity/identity-manager";
import { createCollaborationNode } from "./libp2p/create-node";
import { P2PRuntime } from "./libp2p/p2p-runtime";
import { requestCollabJoinTokenWithOptions } from "./sessions/access-control";
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

type RelayTargetsResponse = {
  targets?: string[];
  hasLocalRelay?: boolean;
};

const DEFAULT_BOOTSTRAP_MULTIADDRS = [
  "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
  "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
];

type RelayDialSource =
  | "initial-prime"
  | "retry-prime"
  | "peer-discovery"
  | "peer-hint";

type RelayDialAttempt = {
  target: string;
  source: RelayDialSource;
  success: boolean;
  timestamp: number;
  error?: string;
};

type IdentityVerifyResult = {
  peerId: string;
  ghostId: string;
  valid: boolean;
  role?: string;
  reason?: string;
  timestamp: number;
};

type RelayDialDiagnostics = {
  attempted: number;
  succeeded: number;
  failed: number;
  lastAttemptAt: number | null;
  lastTarget: string | null;
  lastError: string | null;
  recentAttempts: RelayDialAttempt[];
};

type RealtimeCrdtDiagnostics = {
  crdtSent: number;
  crdtReceived: number;
  decryptFailures: number;
  lastCrdtSentAt: number | null;
  lastCrdtReceivedAt: number | null;
  lastDecryptFailureAt: number | null;
  lastDecryptFailureReason: string | null;
};

type RuntimeRolloutDiagnostics = {
  mode: "legacy" | "compare" | "runtime";
  runtimeSnapshots: number;
  runtimeDialAttempts: number;
  runtimeConnectionCount: number;
  legacyConnectionCount: number;
  lastRuntimeSnapshotAt: number | null;
};

type DialFailureState = {
  failures: number;
  lastFailureAt: number;
  mutedUntil?: number;
};

const DIAL_RETRY_BASE_BACKOFF_MS = 30_000;
const DIAL_RETRY_MAX_BACKOFF_MS = 15 * 60_000;
const DIAL_RETRY_MUTE_AFTER_FAILURES = 5;
const DIAL_RETRY_MUTE_MS = 10 * 60_000;
const DIAL_RETRY_GENERIC_DNSADDR_MUTE_MS = 60 * 60_000;
const RETRY_PRIME_MIN_DISCOVERY_GAP_MS = 60_000;
const CRDT_PUBLISH_DEBOUNCE_MS = 60;
const CRDT_STATE_RESYNC_INTERVAL_MS = 3_000;
const CONNECTION_REFRESH_INTERVAL_MS = 3_000;
const PEER_HINT_REFRESH_INTERVAL_MS = 8_000;
const RUNTIME_ROLLOUT_MODE =
  (process.env.NEXT_PUBLIC_COLLAB_RUNTIME_ROLLOUT as
    | "legacy"
    | "compare"
    | "runtime"
    | undefined) || "compare";
const FORCE_LOCAL_RELAY_ONLY =
  process.env.NEXT_PUBLIC_LIBP2P_FORCE_LOCAL_RELAY_ONLY === "true";

const INITIAL_RELAY_DIAL_DIAGNOSTICS: RelayDialDiagnostics = {
  attempted: 0,
  succeeded: 0,
  failed: 0,
  lastAttemptAt: null,
  lastTarget: null,
  lastError: null,
  recentAttempts: [],
};

const INITIAL_REALTIME_CRDT_DIAGNOSTICS: RealtimeCrdtDiagnostics = {
  crdtSent: 0,
  crdtReceived: 0,
  decryptFailures: 0,
  lastCrdtSentAt: null,
  lastCrdtReceivedAt: null,
  lastDecryptFailureAt: null,
  lastDecryptFailureReason: null,
};

const INITIAL_RUNTIME_ROLLOUT_DIAGNOSTICS: RuntimeRolloutDiagnostics = {
  mode: RUNTIME_ROLLOUT_MODE,
  runtimeSnapshots: 0,
  runtimeDialAttempts: 0,
  runtimeConnectionCount: 0,
  legacyConnectionCount: 0,
  lastRuntimeSnapshotAt: null,
};

function parseAddressList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectRuntimeSeedTargets(runtimeTargets?: string[]) {
  if (runtimeTargets && runtimeTargets.length > 0) {
    return runtimeTargets;
  }

  const isDevelopment = process.env.NODE_ENV !== "production";
  const seedNodesDev = parseAddressList(
    process.env.NEXT_PUBLIC_LIBP2P_SEED_NODES_DEV || process.env.NEXT_PUBLIC_LIBP2P_SEED_NODES
  );
  const seedNodesProd = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_SEED_NODES);
  const relayBootstrapDev = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_RELAY_BOOTSTRAP_ADDR_DEV);
  const relayBootstrapProd = parseAddressList(
    process.env.NEXT_PUBLIC_LIBP2P_RELAY_BOOTSTRAP_ADDR_PROD
  );
  const relaysLegacy = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_RELAYS);
  const bootstrapLegacy = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_BOOTSTRAP);

  if (isDevelopment) {
    if (relayBootstrapDev.length > 0) {
      return relayBootstrapDev;
    }
    if (seedNodesDev.length > 0) {
      return seedNodesDev;
    }
  } else {
    if (seedNodesProd.length > 0) {
      return seedNodesProd;
    }
    if (relayBootstrapProd.length > 0) {
      return relayBootstrapProd;
    }
  }

  if (relaysLegacy.length > 0) {
    return relaysLegacy;
  }
  if (bootstrapLegacy.length > 0) {
    return bootstrapLegacy;
  }
  return DEFAULT_BOOTSTRAP_MULTIADDRS;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function isLocalhostTarget(target: string) {
  const normalized = target.toLowerCase();
  return (
    normalized.includes("/ip4/127.0.0.1/") ||
    normalized.includes("/dns4/localhost/")
  );
}

async function fetchRuntimeRelayTargets() {
  try {
    const response = await fetch("/api/collab/relay-targets", { cache: "no-store" });
    if (!response.ok) {
      return [] as string[];
    }

    const payload = (await response.json()) as {
      success?: boolean;
      data?: RelayTargetsResponse;
    };

    if (!payload.success) {
      return [] as string[];
    }

    return (payload.data?.targets || []).map((entry) => entry.trim()).filter(Boolean);
  } catch {
    return [] as string[];
  }
}

function isBrowserDialableMultiaddr(value: string) {
  const normalized = value.toLowerCase();
  if (!normalized.startsWith("/")) {
    return false;
  }

  return (
    normalized.includes("/dnsaddr/") ||
    normalized.includes("/ws") ||
    normalized.includes("/wss") ||
    normalized.includes("/webrtc") ||
    normalized.includes("/webtransport") ||
    normalized.includes("/p2p-circuit")
  );
}

function isImmediateDialCandidate(value: string) {
  const normalized = value.toLowerCase();
  if (!isBrowserDialableMultiaddr(normalized)) {
    return false;
  }

  // Prefer explicit peer targets when dialing from browser contexts.
  return normalized.includes("/p2p/") || normalized.includes("/dnsaddr/");
}

function hasPeerIdInTarget(target: string) {
  return /\/p2p\/[A-Za-z0-9]+/.test(target);
}

function isGenericDnsaddrTarget(target: string) {
  const normalized = target.toLowerCase();
  return normalized.includes("/dnsaddr/") &&
    !normalized.includes("/ws") &&
    !normalized.includes("/wss") &&
    !normalized.includes("/webtransport") &&
    !normalized.includes("/webrtc") &&
    !normalized.includes("/p2p-circuit");
}

function hasConcreteRelayPath(target: string) {
  const normalized = target.toLowerCase();
  return (
    normalized.includes("/ws") ||
    normalized.includes("/wss") ||
    normalized.includes("/webtransport") ||
    normalized.includes("/webrtc") ||
    normalized.includes("/p2p-circuit")
  );
}

function isInsecureWebSocketTarget(target: string) {
  const normalized = target.toLowerCase();
  return normalized.includes("/ws") && !normalized.includes("/wss");
}

function isPeerIdOnlyTarget(target: string) {
  return /^\/p2p\/[A-Za-z0-9]+$/.test(target);
}

function getConfiguredBootstrapTargets() {
  const selected = selectRuntimeSeedTargets();
  const dialable = selected.filter(isBrowserDialableMultiaddr);
  return unique(FORCE_LOCAL_RELAY_ONLY ? dialable.filter(isLocalhostTarget) : dialable);
}

function getConfiguredRelayTargets(runtimeTargets?: string[]) {
  const selected = selectRuntimeSeedTargets(runtimeTargets);
  const dialable = selected.filter(isBrowserDialableMultiaddr);
  return unique(FORCE_LOCAL_RELAY_ONLY ? dialable.filter(isLocalhostTarget) : dialable);
}

function buildRelayCircuitDialTargets(options: {
  peerId: string;
  relayTargets: string[];
}) {
  const targets: string[] = [];
  for (const relayTarget of options.relayTargets) {
    if (!hasPeerIdInTarget(relayTarget)) {
      continue;
    }

    const normalized = relayTarget.replace(/\/+$/, "");
    if (normalized.includes("/p2p-circuit")) {
      targets.push(`${normalized}/p2p/${options.peerId}`);
      continue;
    }

    targets.push(`${normalized}/p2p-circuit/p2p/${options.peerId}`);
  }

  // Fallback for peerstore-known routes.
  targets.push(`/p2p/${options.peerId}`);
  return unique(targets);
}

async function dialPeerHints(
  node: {
    dial?: (target: unknown) => Promise<unknown>;
  },
  options: {
    peerHints?: string[];
    shouldAttemptTarget: (target: string) => boolean;
    recordRelayDialAttempt: (attempt: RelayDialAttempt) => void;
    recordDialResult: (target: string, success: boolean) => void;
    runtimeRelayTargets?: string[];
  }
) {
  if (!node.dial || !options.peerHints || options.peerHints.length === 0) {
    return;
  }

  const relayTargets = getConfiguredRelayTargets(options.runtimeRelayTargets);
  const bootstrapTargets = getConfiguredBootstrapTargets();
  const baseRelayTargets = relayTargets.length > 0 ? relayTargets : bootstrapTargets;

  for (const peerId of options.peerHints) {
    const dialTargets = buildRelayCircuitDialTargets({
      peerId,
      relayTargets: baseRelayTargets,
    });

    for (const target of dialTargets) {
      if (!options.shouldAttemptTarget(target)) {
        continue;
      }

      try {
        await node.dial(target);
        options.recordDialResult(target, true);
        options.recordRelayDialAttempt({
          target,
          source: "peer-hint",
          success: true,
          timestamp: Date.now(),
        });
        break;
      } catch {
        options.recordDialResult(target, false);
        options.recordRelayDialAttempt({
          target,
          source: "peer-hint",
          success: false,
          timestamp: Date.now(),
          error: "DIAL_FAILED",
        });
      }
    }
  }
}

async function primeRelayConnections(node: {
  dial?: (target: unknown) => Promise<unknown>;
}, options?: {
  source?: RelayDialSource;
  onAttempt?: (attempt: RelayDialAttempt) => void;
  shouldAttemptTarget?: (target: string) => boolean;
  onDialResult?: (target: string, success: boolean) => void;
  runtimeRelayTargets?: string[];
}) {
  if (!node.dial) {
    return;
  }

  const relayTargets = getConfiguredRelayTargets(options?.runtimeRelayTargets);
  const bootstrapTargets = getConfiguredBootstrapTargets();
  const selectedTargets = relayTargets.length > 0 ? relayTargets : bootstrapTargets;
  const targets = unique(selectedTargets).filter(isImmediateDialCandidate);

  if (targets.length === 0) {
    return;
  }

  for (const target of targets) {
    const targetLabel = String(target);
    if (options?.shouldAttemptTarget && !options.shouldAttemptTarget(targetLabel)) {
      continue;
    }

    try {
      await node.dial?.(target);
      options?.onDialResult?.(targetLabel, true);
      options?.onAttempt?.({
        target: targetLabel,
        source: options?.source || "initial-prime",
        success: true,
        timestamp: Date.now(),
      });
    } catch {
      options?.onDialResult?.(targetLabel, false);
      options?.onAttempt?.({
        target: targetLabel,
        source: options?.source || "initial-prime",
        success: false,
        timestamp: Date.now(),
        error: "DIAL_FAILED",
      });
      // Keep trying remaining relay/bootstrap peers.
    }
  }
}

function extractDiscoveredPeer(event: Event) {
  const detail = (
    event as Event & { detail?: { id?: unknown; multiaddrs?: unknown[] } }
  ).detail;
  return detail;
}

function toDialTargetLabel(target: unknown) {
  if (typeof target === "string") {
    return target;
  }

  if (target && typeof target === "object") {
    const withToString = target as { toString?: () => string };
    const asString = withToString.toString?.();
    if (asString) {
      return asString;
    }
  }

  return "unknown-target";
}

function getDiscoveredDialTargets(discoveredPeer: {
  id?: unknown;
  multiaddrs?: unknown[];
}) {
  const targets: string[] = [];
  const idLabel = toDialTargetLabel(discoveredPeer.id);

  if (Array.isArray(discoveredPeer.multiaddrs)) {
    for (const multiaddr of discoveredPeer.multiaddrs) {
      const label = toDialTargetLabel(multiaddr);
      if (label !== "unknown-target") {
        const withPeerId =
          idLabel !== "unknown-target" && !hasPeerIdInTarget(label)
            ? `${label}/p2p/${idLabel}`
            : label;
        targets.push(withPeerId);
      }
    }
  }

  const dialableTargets = unique(targets).filter(isImmediateDialCandidate);
  if (!FORCE_LOCAL_RELAY_ONLY) {
    return dialableTargets;
  }
  return dialableTargets.filter(isLocalhostTarget);
}

function getDiscoveredPeerIdLabel(discoveredPeer: {
  id?: unknown;
}) {
  const idLabel = toDialTargetLabel(discoveredPeer.id);
  return idLabel !== "unknown-target" ? idLabel : null;
}

function getEffectiveConnectionCount(options: {
  node: {
    getConnections?: () => unknown[];
  };
  session?: SessionManager | null;
}) {
  const transportCount = options.node.getConnections
    ? options.node.getConnections().length
    : 0;
  const sessionPeerCount = options.session ? options.session.getPeers().length : 0;
  return Math.max(transportCount, sessionPeerCount);
}

function getConnectedPeerIds(node: {
  getConnections?: () => unknown[];
}) {
  if (!node.getConnections) {
    return [] as string[];
  }

  const ids = node
    .getConnections()
    .map((connection) => {
      if (!connection || typeof connection !== "object") {
        return null;
      }

      const remotePeer = (connection as { remotePeer?: { toString?: () => string } }).remotePeer;
      const peerId = remotePeer?.toString?.();
      return peerId || null;
    })
    .filter((peerId): peerId is string => Boolean(peerId));

  return unique(ids);
}

function extractTransportsFromConnection(connection: unknown) {
  const transports = new Set<string>();

  if (!connection || typeof connection !== "object") {
    return [] as string[];
  }

  const remoteAddr = (connection as { remoteAddr?: { toString?: () => string } }).remoteAddr;
  const addr = remoteAddr?.toString?.()?.toLowerCase() || "";
  if (addr.includes("/webrtc") || addr.includes("/webrtc-direct")) {
    transports.add("webrtc");
  }
  if ((addr.includes("/ws") || addr.includes("/wss")) && !addr.includes("/p2p-circuit")) {
    transports.add("websocket");
  }
  if (addr.includes("/webtransport")) {
    transports.add("webtransport");
  }
  if (addr.includes("/p2p-circuit")) {
    transports.add("circuit-relay");
  }

  return Array.from(transports);
}

function refreshConnectionsFromNode(options: {
  node: {
    getConnections?: () => unknown[];
    peerId?: { toString?: () => string };
  };
  observedPeerIds: Set<string>;
  peerConnectionTransports: Map<string, Map<string, Set<string>>>;
  localPeerId?: string | null;
}) {
  const connections = options.node.getConnections?.() || [];

  options.observedPeerIds.clear();
  options.peerConnectionTransports.clear();

  for (const connection of connections) {
    if (!connection || typeof connection !== "object") {
      continue;
    }

    const remotePeer = (connection as { remotePeer?: { toString?: () => string } }).remotePeer;
    const peerId = remotePeer?.toString?.();
    if (!peerId) {
      continue;
    }

    if (options.localPeerId && peerId === options.localPeerId) {
      continue;
    }

    options.observedPeerIds.add(peerId);

    const connectionId =
      (connection as { id?: string }).id ||
      `${peerId}-${Math.random().toString(36).slice(2, 10)}`;
    const transports = extractTransportsFromConnection(connection);

    if (!options.peerConnectionTransports.has(peerId)) {
      options.peerConnectionTransports.set(peerId, new Map());
    }

    options.peerConnectionTransports
      .get(peerId)
      ?.set(connectionId, new Set(transports));
  }

  return Array.from(options.observedPeerIds);
}

function extractPeerIdFromEvent(event: Event) {
  const detail = (event as Event & {
    detail?: {
      id?: { toString?: () => string } | string;
      remotePeer?: { toString?: () => string } | string;
    } | { toString?: () => string } | string;
  }).detail;

  if (!detail) {
    return null;
  }

  if (typeof detail === "string") {
    return detail;
  }

  if (typeof detail === "object") {
    const peerObject = (
      ("id" in detail ? detail.id : undefined) ||
      ("remotePeer" in detail ? detail.remotePeer : undefined) ||
      detail
    ) as { toString?: () => string } | string | undefined;

    if (typeof peerObject === "string") {
      return peerObject;
    }

    return peerObject?.toString?.() || null;
  }

  return null;
}

function mergeConnectedPeerIds(options: {
  node: {
    getConnections?: () => unknown[];
  };
  observedPeerIds: Set<string>;
  localPeerId?: string | null;
}) {
  const fromConnections = getConnectedPeerIds(options.node);
  const merged = unique([...fromConnections, ...Array.from(options.observedPeerIds)]);

  if (!options.localPeerId) {
    return merged;
  }

  return merged.filter((peerId) => peerId !== options.localPeerId);
}

function getOrCreateAnonymousGhostId() {
  if (typeof window === "undefined") {
    return `ghost-anon-${Date.now().toString(16)}`;
  }

  const storageKey = "ghostdocs-anon-ghost-id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(16).slice(2, 12);

  const generated = `ghost-anon-${randomPart}`;
  window.localStorage.setItem(storageKey, generated);
  return generated;
}

async function ensureGhostId(options?: { accessToken?: string }) {
  const getResponse = await fetch("/api/ghostid", { cache: "no-store" });
  const getPayload = await getResponse.json().catch(() => ({}));
  const ghostId = getPayload?.data?.ghostId as string | null | undefined;

  if (ghostId) {
    return ghostId;
  }

  if (!getResponse.ok && options?.accessToken) {
    return getOrCreateAnonymousGhostId();
  }

  const createResponse = await fetch("/api/ghostid", {
    method: "POST",
  });
  const createPayload = await createResponse.json().catch(() => ({}));
  const createdGhostId = createPayload?.data?.ghostId as string | null | undefined;

  if (!createResponse.ok && options?.accessToken) {
    return getOrCreateAnonymousGhostId();
  }

  if (!createdGhostId) {
    throw new Error("Failed to initialize GhostID for collaboration.");
  }

  return createdGhostId;
}

export function useDocumentCollaboration(options: {
  documentId: string;
  enabled: boolean;
  accessToken?: string;
  initialContent: string;
  onRemoteContentChange: (next: string) => void;
}) {
  const { documentId, enabled, accessToken, initialContent, onRemoteContentChange } = options;
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [role, setRole] = useState<string | null>(null);
  const [peers, setPeers] = useState<SessionPeer[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [connectionCount, setConnectionCount] = useState(0);
  const [connectedPeerIds, setConnectedPeerIds] = useState<string[]>([]);
  const [lastIdentityVerify, setLastIdentityVerify] =
    useState<IdentityVerifyResult | null>(null);
  const [lastPeerDiscoveryAt, setLastPeerDiscoveryAt] = useState<number | null>(null);
  const [relayDial, setRelayDial] = useState<RelayDialDiagnostics>(
    INITIAL_RELAY_DIAL_DIAGNOSTICS
  );
  const [realtimeCrdt, setRealtimeCrdt] = useState<RealtimeCrdtDiagnostics>(
    INITIAL_REALTIME_CRDT_DIAGNOSTICS
  );
  const [runtimeRollout, setRuntimeRollout] = useState<RuntimeRolloutDiagnostics>(
    INITIAL_RUNTIME_ROLLOUT_DIAGNOSTICS
  );

  const sessionRef = useRef<SessionManager | null>(null);
  const nodeRef = useRef<{
    dial?: (target: unknown) => Promise<unknown>;
    getConnections?: () => unknown[];
    removeEventListener?: (type: string, listener: (event: Event) => void) => void;
  } | null>(null);
  const peerDiscoveryListenerRef = useRef<((event: Event) => void) | null>(null);
  const peerConnectListenerRef = useRef<((event: Event) => void) | null>(null);
  const peerDisconnectListenerRef = useRef<((event: Event) => void) | null>(null);
  const connectionOpenListenerRef = useRef<((event: Event) => void) | null>(null);
  const connectionCloseListenerRef = useRef<((event: Event) => void) | null>(null);
  const yjsRef = useRef<YjsSync | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const diagnosticsRef = useRef<number | null>(null);
  const relayRetryRef = useRef<number | null>(null);
  const stateResyncRef = useRef<number | null>(null);
  const connectionRefreshRef = useRef<number | null>(null);
  const peerHintRefreshRef = useRef<number | null>(null);
  const runtimeRef = useRef<P2PRuntime | null>(null);
  const initializedRef = useRef(false);
  const initialContentRef = useRef(initialContent);
  const onRemoteContentChangeRef = useRef(onRemoteContentChange);
  const pendingCrdtUpdateRef = useRef<string | null>(null);
  const crdtPublishTimerRef = useRef<number | null>(null);
  const crdtPublishInFlightRef = useRef(false);
  const dialFailuresRef = useRef(new Map<string, DialFailureState>());
  const runtimeRelayTargetsRef = useRef<string[]>([]);
  const secureContextWarningShownRef = useRef(false);
  const lastPeerDiscoveryAtRef = useRef<number | null>(null);
  const observedConnectedPeerIdsRef = useRef<Set<string>>(new Set());
  const peerConnectionTransportsRef = useRef<Map<string, Map<string, Set<string>>>>(
    new Map()
  );

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

    if (stateResyncRef.current) {
      window.clearInterval(stateResyncRef.current);
      stateResyncRef.current = null;
    }

    if (connectionRefreshRef.current) {
      window.clearInterval(connectionRefreshRef.current);
      connectionRefreshRef.current = null;
    }

    if (peerHintRefreshRef.current) {
      window.clearInterval(peerHintRefreshRef.current);
      peerHintRefreshRef.current = null;
    }

    if (crdtPublishTimerRef.current) {
      window.clearTimeout(crdtPublishTimerRef.current);
      crdtPublishTimerRef.current = null;
    }

    pendingCrdtUpdateRef.current = null;
    crdtPublishInFlightRef.current = false;

    runtimeRef.current?.stop();
    runtimeRef.current = null;

    const session = sessionRef.current;
    const node = nodeRef.current;
    const onPeerDiscovery = peerDiscoveryListenerRef.current;
    const onPeerConnect = peerConnectListenerRef.current;
    const onPeerDisconnect = peerDisconnectListenerRef.current;
    const onConnectionOpen = connectionOpenListenerRef.current;
    const onConnectionClose = connectionCloseListenerRef.current;

    if (node && onPeerDiscovery) {
      node.removeEventListener?.("peer:discovery", onPeerDiscovery);
    }
    if (node && onPeerConnect) {
      node.removeEventListener?.("peer:connect", onPeerConnect);
    }
    if (node && onPeerDisconnect) {
      node.removeEventListener?.("peer:disconnect", onPeerDisconnect);
    }
    if (node && onConnectionOpen) {
      node.removeEventListener?.("connection:open", onConnectionOpen);
    }
    if (node && onConnectionClose) {
      node.removeEventListener?.("connection:close", onConnectionClose);
    }

    nodeRef.current = null;
    peerDiscoveryListenerRef.current = null;
    peerConnectListenerRef.current = null;
    peerDisconnectListenerRef.current = null;
    connectionOpenListenerRef.current = null;
    connectionCloseListenerRef.current = null;

    sessionRef.current = null;
    yjsRef.current = null;
    initializedRef.current = false;
    setConnectionCount(0);
    setConnectedPeerIds([]);
    setLastIdentityVerify(null);
    setLastPeerDiscoveryAt(null);
    lastPeerDiscoveryAtRef.current = null;
    setRelayDial(INITIAL_RELAY_DIAL_DIAGNOSTICS);
    setRealtimeCrdt(INITIAL_REALTIME_CRDT_DIAGNOSTICS);
    setRuntimeRollout(INITIAL_RUNTIME_ROLLOUT_DIAGNOSTICS);
    dialFailuresRef.current.clear();
    secureContextWarningShownRef.current = false;
    observedConnectedPeerIdsRef.current.clear();
    peerConnectionTransportsRef.current.clear();

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

        const ghostId = await ensureGhostId({ accessToken });
        if (disposed) {
          return;
        }

        const { identity, privateKey } = await buildCollaborationIdentity(ghostId);
        if (disposed) {
          return;
        }

        const join = await requestCollabJoinTokenWithOptions({
          docId: documentId,
          peerId: identity.peerId,
          accessToken,
          ghostId,
        });
        if (disposed) {
          return;
        }

        runtimeRelayTargetsRef.current = await fetchRuntimeRelayTargets();

        const recordRelayDialAttempt = (attempt: RelayDialAttempt) => {
          setRelayDial((previous) => {
            const recentAttempts = [...previous.recentAttempts, attempt].slice(-20);
            return {
              attempted: previous.attempted + 1,
              succeeded: previous.succeeded + (attempt.success ? 1 : 0),
              failed: previous.failed + (attempt.success ? 0 : 1),
              lastAttemptAt: attempt.timestamp,
              lastTarget: attempt.target,
              lastError: attempt.success ? null : attempt.error || "DIAL_FAILED",
              recentAttempts,
            };
          });
        };

        const shouldAttemptDialTarget = (target: string) => {
          if (
            FORCE_LOCAL_RELAY_ONLY &&
            !isLocalhostTarget(target) &&
            !isPeerIdOnlyTarget(target)
          ) {
            return false;
          }

          if (
            typeof window !== "undefined" &&
            window.location.protocol === "https:" &&
            isInsecureWebSocketTarget(target)
          ) {
            if (!secureContextWarningShownRef.current) {
              secureContextWarningShownRef.current = true;
              setError(
                "This app is running on HTTPS, so insecure ws relay targets are blocked by browser security. Configure a wss/webtransport relay target."
              );
            }
            return false;
          }

          const state = dialFailuresRef.current.get(target);
          if (!state) {
            return true;
          }

          if (state.mutedUntil && Date.now() < state.mutedUntil) {
            return false;
          }

          const backoffMs = Math.min(
            DIAL_RETRY_MAX_BACKOFF_MS,
            DIAL_RETRY_BASE_BACKOFF_MS * 2 ** Math.max(state.failures - 1, 0)
          );

          return Date.now() - state.lastFailureAt >= backoffMs;
        };

        const recordDialResult = (target: string, success: boolean) => {
          if (success) {
            dialFailuresRef.current.delete(target);
            return;
          }

          const current = dialFailuresRef.current.get(target);
          const nextFailures = (current?.failures || 0) + 1;
          const genericDnsaddrFailure = isGenericDnsaddrTarget(target);
          const shouldMute = nextFailures >= DIAL_RETRY_MUTE_AFTER_FAILURES;
          dialFailuresRef.current.set(target, {
            failures: nextFailures,
            lastFailureAt: Date.now(),
            mutedUntil: genericDnsaddrFailure
              ? Date.now() + DIAL_RETRY_GENERIC_DNSADDR_MUTE_MS
              : shouldMute
              ? Date.now() + DIAL_RETRY_MUTE_MS
              : undefined,
          });
        };

        const configuredRelayTargets = getConfiguredRelayTargets(runtimeRelayTargetsRef.current);
        const bootstrapTargets = getConfiguredBootstrapTargets();
        const availableRelayTargets = unique(
          configuredRelayTargets.length > 0
            ? configuredRelayTargets
            : bootstrapTargets
        );

        const hasConcreteRelayTarget = availableRelayTargets.some(hasConcreteRelayPath);
        if (!hasConcreteRelayTarget) {
          setError(
            "No concrete browser-dialable relay target configured. Set NEXT_PUBLIC_LIBP2P_RELAYS to explicit ws/webtransport relay multiaddrs."
          );
        } else if (FORCE_LOCAL_RELAY_ONLY && availableRelayTargets.length === 0) {
          setError(
            "Local-only relay mode is enabled but no localhost relay target is available."
          );
        }

        const node = await createCollaborationNode(privateKey);
        await node.start();
        await primeRelayConnections(node, {
          source: "initial-prime",
          onAttempt: recordRelayDialAttempt,
          shouldAttemptTarget: shouldAttemptDialTarget,
          onDialResult: recordDialResult,
          runtimeRelayTargets: runtimeRelayTargetsRef.current,
        });
        await dialPeerHints(node, {
          peerHints: join.peerHints,
          shouldAttemptTarget: shouldAttemptDialTarget,
          recordRelayDialAttempt,
          recordDialResult,
          runtimeRelayTargets: runtimeRelayTargetsRef.current,
        });
        nodeRef.current = node;

        const onPeerDiscovery = (event: Event) => {
          const discoveredPeer = extractDiscoveredPeer(event);
          const discoveredAt = Date.now();
          lastPeerDiscoveryAtRef.current = discoveredAt;
          setLastPeerDiscoveryAt(discoveredAt);
          if (!discoveredPeer || !node.dial) {
            return;
          }

          const dialTargets = getDiscoveredDialTargets(discoveredPeer);

          void (async () => {
            const peerIdTarget = getDiscoveredPeerIdLabel(discoveredPeer);
            let dialed = false;

            if (peerIdTarget && shouldAttemptDialTarget(`/p2p/${peerIdTarget}`)) {
              try {
                await node.dial?.(discoveredPeer.id);
                recordRelayDialAttempt({
                  target: `/p2p/${peerIdTarget}`,
                  source: "peer-discovery",
                  success: true,
                  timestamp: Date.now(),
                });
                dialed = true;
              } catch {
                recordRelayDialAttempt({
                  target: `/p2p/${peerIdTarget}`,
                  source: "peer-discovery",
                  success: false,
                  timestamp: Date.now(),
                  error: "DIAL_FAILED",
                });
              }
            }

            if (dialed) {
              return;
            }

            if (dialTargets.length === 0) {
              return;
            }

            for (const target of dialTargets) {
              if (!shouldAttemptDialTarget(target)) {
                continue;
              }

              try {
                await node.dial?.(target);
                recordDialResult(target, true);
                recordRelayDialAttempt({
                  target: toDialTargetLabel(target),
                  source: "peer-discovery",
                  success: true,
                  timestamp: Date.now(),
                });
                break;
              } catch {
                recordDialResult(target, false);
                recordRelayDialAttempt({
                  target: toDialTargetLabel(target),
                  source: "peer-discovery",
                  success: false,
                  timestamp: Date.now(),
                  error: "DIAL_FAILED",
                });
                // Keep trying next discovered target/address variant.
              }
            }
          })();
        };

        const onPeerConnect = (event: Event) => {
          const peerId = extractPeerIdFromEvent(event);
          if (peerId) {
            observedConnectedPeerIdsRef.current.add(peerId);
          }
          const nextCount = getEffectiveConnectionCount({
            node,
            session: sessionRef.current,
          });
          setConnectionCount(nextCount);
          setConnectedPeerIds(
            mergeConnectedPeerIds({
              node,
              observedPeerIds: observedConnectedPeerIdsRef.current,
              localPeerId: node.peerId?.toString?.() || identity.peerId,
            })
          );

          // Push latest state immediately when transport connectivity changes.
          void publishCurrentStateSnapshot();
        };

        const onPeerDisconnect = (event: Event) => {
          const peerId = extractPeerIdFromEvent(event);
          if (peerId) {
            observedConnectedPeerIdsRef.current.delete(peerId);
          }
          const nextCount = getEffectiveConnectionCount({
            node,
            session: sessionRef.current,
          });
          setConnectionCount(nextCount);
          setConnectedPeerIds(
            mergeConnectedPeerIds({
              node,
              observedPeerIds: observedConnectedPeerIdsRef.current,
              localPeerId: node.peerId?.toString?.() || identity.peerId,
            })
          );
        };

        const onConnectionOpen = () => {
          refreshConnectionsFromNode({
            node,
            observedPeerIds: observedConnectedPeerIdsRef.current,
            peerConnectionTransports: peerConnectionTransportsRef.current,
            localPeerId: node.peerId?.toString?.() || identity.peerId,
          });

          setConnectionCount(getEffectiveConnectionCount({ node, session: sessionRef.current }));
          setConnectedPeerIds(
            mergeConnectedPeerIds({
              node,
              observedPeerIds: observedConnectedPeerIdsRef.current,
              localPeerId: node.peerId?.toString?.() || identity.peerId,
            })
          );
        };

        const onConnectionClose = () => {
          refreshConnectionsFromNode({
            node,
            observedPeerIds: observedConnectedPeerIdsRef.current,
            peerConnectionTransports: peerConnectionTransportsRef.current,
            localPeerId: node.peerId?.toString?.() || identity.peerId,
          });

          setConnectionCount(getEffectiveConnectionCount({ node, session: sessionRef.current }));
          setConnectedPeerIds(
            mergeConnectedPeerIds({
              node,
              observedPeerIds: observedConnectedPeerIdsRef.current,
              localPeerId: node.peerId?.toString?.() || identity.peerId,
            })
          );
        };

        const useRuntimePath = RUNTIME_ROLLOUT_MODE === "runtime";

        if (!useRuntimePath) {
          node.addEventListener?.("peer:discovery", onPeerDiscovery);
          node.addEventListener?.("peer:connect", onPeerConnect);
          node.addEventListener?.("peer:disconnect", onPeerDisconnect);
          node.addEventListener?.("connection:open", onConnectionOpen);
          node.addEventListener?.("connection:close", onConnectionClose);
          peerDiscoveryListenerRef.current = onPeerDiscovery;
          peerConnectListenerRef.current = onPeerConnect;
          peerDisconnectListenerRef.current = onPeerDisconnect;
          connectionOpenListenerRef.current = onConnectionOpen;
          connectionCloseListenerRef.current = onConnectionClose;
        }

        if (RUNTIME_ROLLOUT_MODE !== "legacy") {
          const runtime = new P2PRuntime({
            node,
            localPeerId: node.peerId?.toString?.() || identity.peerId,
            forceLocalRelayOnly: FORCE_LOCAL_RELAY_ONLY,
            autoDial: RUNTIME_ROLLOUT_MODE === "runtime",
            shouldAttemptTarget: shouldAttemptDialTarget,
            onDialAttempt: (attempt) => {
              recordRelayDialAttempt(attempt);
              recordDialResult(attempt.target, attempt.success);
              setRuntimeRollout((previous) => ({
                ...previous,
                runtimeDialAttempts: previous.runtimeDialAttempts + 1,
              }));
            },
            onSnapshot: (snapshot) => {
              setRuntimeRollout((previous) => ({
                ...previous,
                runtimeSnapshots: previous.runtimeSnapshots + 1,
                runtimeConnectionCount: snapshot.connectionCount,
                lastRuntimeSnapshotAt: Date.now(),
              }));

              if (RUNTIME_ROLLOUT_MODE === "runtime") {
                if (snapshot.lastPeerDiscoveryAt) {
                  lastPeerDiscoveryAtRef.current = snapshot.lastPeerDiscoveryAt;
                  setLastPeerDiscoveryAt(snapshot.lastPeerDiscoveryAt);
                }
                setConnectedPeerIds(snapshot.connectedPeerIds);
                setConnectionCount(snapshot.connectionCount);
              }
            },
          });

          runtime.start();
          runtimeRef.current = runtime;
        }

        refreshConnectionsFromNode({
          node,
          observedPeerIds: observedConnectedPeerIdsRef.current,
          peerConnectionTransports: peerConnectionTransportsRef.current,
          localPeerId: node.peerId?.toString?.() || identity.peerId,
        });

        setLocalPeerId(node.peerId?.toString?.() || identity.peerId);

        const session = new SessionManager({
          node,
          identity,
          token: join.token,
          sessionKey: join.sessionKey,
          role: join.role,
          docId: documentId,
        });
        sessionRef.current = session;

        const yjs = new YjsSync(initialContentRef.current);
        yjsRef.current = yjs;

        session.addEventListener("peer:joined", () => {
          setPeers(session.getPeers());
          setConnectionCount(getEffectiveConnectionCount({ node, session }));
          setConnectedPeerIds(
            mergeConnectedPeerIds({
              node,
              observedPeerIds: observedConnectedPeerIdsRef.current,
              localPeerId: node.peerId?.toString?.() || identity.peerId,
            })
          );
          void publishCurrentStateSnapshot();
        });

        session.addEventListener("peer:left", () => {
          setPeers(session.getPeers());
          setConnectionCount(getEffectiveConnectionCount({ node, session }));
          setConnectedPeerIds(
            mergeConnectedPeerIds({
              node,
              observedPeerIds: observedConnectedPeerIdsRef.current,
              localPeerId: node.peerId?.toString?.() || identity.peerId,
            })
          );
        });

        session.addEventListener("peer:update", () => {
          setPeers(session.getPeers());
          setConnectionCount(getEffectiveConnectionCount({ node, session }));
          setConnectedPeerIds(
            mergeConnectedPeerIds({
              node,
              observedPeerIds: observedConnectedPeerIdsRef.current,
              localPeerId: node.peerId?.toString?.() || identity.peerId,
            })
          );
        });

        session.addEventListener("identity:verify", (event) => {
          const detail = (
            event as CustomEvent<{
              peerId: string;
              ghostId: string;
              valid: boolean;
              role?: string;
              timestamp: number;
              reason?: string;
            }>
          ).detail;

          setLastIdentityVerify({
            peerId: detail.peerId,
            ghostId: detail.ghostId,
            valid: detail.valid,
            role: detail.role,
            reason: detail.reason,
            timestamp: detail.timestamp,
          });
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
            setRealtimeCrdt((previous) => ({
              ...previous,
              crdtReceived: previous.crdtReceived + 1,
              lastCrdtReceivedAt: Date.now(),
            }));
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

        session.addEventListener("message:decrypt-failed", (event) => {
          const detail = (
            event as CustomEvent<{
              timestamp?: number;
              reason?: string;
            }>
          ).detail;

          setRealtimeCrdt((previous) => ({
            ...previous,
            decryptFailures: previous.decryptFailures + 1,
            lastDecryptFailureAt: detail?.timestamp ?? Date.now(),
            lastDecryptFailureReason:
              detail?.reason || "MALFORMED_OR_UNREADABLE_MESSAGE",
          }));
        });

        await session.join();

        setRole(join.role);
        setStatus("connected");
        setConnectedPeerIds(
          mergeConnectedPeerIds({
            node,
            observedPeerIds: observedConnectedPeerIdsRef.current,
            localPeerId: node.peerId?.toString?.() || identity.peerId,
          })
        );
        void publishCurrentStateSnapshot();

        heartbeatRef.current = window.setInterval(() => {
          void session.heartbeat();
        }, 20_000);

        stateResyncRef.current = window.setInterval(() => {
          if (getEffectiveConnectionCount({ node, session: sessionRef.current }) <= 0) {
            return;
          }

          // Periodic state announce helps new/late subscribers converge without refresh.
          void publishCurrentStateSnapshot();
        }, CRDT_STATE_RESYNC_INTERVAL_MS);

        peerHintRefreshRef.current = window.setInterval(() => {
          void (async () => {
            try {
              const refresh = await requestCollabJoinTokenWithOptions({
                docId: documentId,
                peerId: identity.peerId,
                accessToken,
                ghostId,
              });

              await dialPeerHints(node, {
                peerHints: refresh.peerHints,
                shouldAttemptTarget: shouldAttemptDialTarget,
                recordRelayDialAttempt,
                recordDialResult,
                runtimeRelayTargets: runtimeRelayTargetsRef.current,
              });
            } catch {
              // Ignore transient peer-hint refresh failures.
            }
          })();
        }, PEER_HINT_REFRESH_INTERVAL_MS);

        diagnosticsRef.current = window.setInterval(() => {
          refreshConnectionsFromNode({
            node,
            observedPeerIds: observedConnectedPeerIdsRef.current,
            peerConnectionTransports: peerConnectionTransportsRef.current,
            localPeerId: node.peerId?.toString?.() || identity.peerId,
          });

          const nextCount = getEffectiveConnectionCount({
            node,
            session: sessionRef.current,
          });
          setRuntimeRollout((previous) => ({
            ...previous,
            legacyConnectionCount: nextCount,
          }));

          if (RUNTIME_ROLLOUT_MODE === "runtime") {
            return;
          }

          setConnectionCount(nextCount);
          setConnectedPeerIds(
            mergeConnectedPeerIds({
              node,
              observedPeerIds: observedConnectedPeerIdsRef.current,
              localPeerId: node.peerId?.toString?.() || identity.peerId,
            })
          );
        }, 4_000);

        connectionRefreshRef.current = window.setInterval(() => {
          refreshConnectionsFromNode({
            node,
            observedPeerIds: observedConnectedPeerIdsRef.current,
            peerConnectionTransports: peerConnectionTransportsRef.current,
            localPeerId: node.peerId?.toString?.() || identity.peerId,
          });

          setConnectionCount(getEffectiveConnectionCount({ node, session: sessionRef.current }));
          setConnectedPeerIds(
            mergeConnectedPeerIds({
              node,
              observedPeerIds: observedConnectedPeerIdsRef.current,
              localPeerId: node.peerId?.toString?.() || identity.peerId,
            })
          );
        }, CONNECTION_REFRESH_INTERVAL_MS);

        relayRetryRef.current = window.setInterval(() => {
          const nextCount = getEffectiveConnectionCount({
            node,
            session: sessionRef.current,
          });
          if (nextCount > 0) {
            return;
          }

          if (
            lastPeerDiscoveryAtRef.current &&
            Date.now() - lastPeerDiscoveryAtRef.current < RETRY_PRIME_MIN_DISCOVERY_GAP_MS
          ) {
            return;
          }

          void primeRelayConnections(node, {
            source: "retry-prime",
            onAttempt: recordRelayDialAttempt,
            shouldAttemptTarget: shouldAttemptDialTarget,
            onDialResult: recordDialResult,
            runtimeRelayTargets: runtimeRelayTargetsRef.current,
          });
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
  }, [documentId, enabled, accessToken, stopSession]);

  const flushPendingCrdtUpdate = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || crdtPublishInFlightRef.current) {
      return;
    }

    const update = pendingCrdtUpdateRef.current;
    if (!update) {
      return;
    }

    pendingCrdtUpdateRef.current = null;
    crdtPublishInFlightRef.current = true;

    try {
      await session.publish("crdt-update", {
        update,
      });
      setRealtimeCrdt((previous) => ({
        ...previous,
        crdtSent: previous.crdtSent + 1,
        lastCrdtSentAt: Date.now(),
      }));
    } finally {
      crdtPublishInFlightRef.current = false;

      if (pendingCrdtUpdateRef.current) {
        void flushPendingCrdtUpdate();
      }
    }
  }, []);

  const queueCrdtUpdate = useCallback((encodedUpdate: string) => {
    pendingCrdtUpdateRef.current = encodedUpdate;

    if (crdtPublishTimerRef.current) {
      window.clearTimeout(crdtPublishTimerRef.current);
    }

    crdtPublishTimerRef.current = window.setTimeout(() => {
      crdtPublishTimerRef.current = null;
      void flushPendingCrdtUpdate();
    }, CRDT_PUBLISH_DEBOUNCE_MS);
  }, [flushPendingCrdtUpdate]);

  const publishCurrentStateSnapshot = useCallback(async () => {
    const session = sessionRef.current;
    const yjs = yjsRef.current;

    if (!session || !yjs) {
      return;
    }

    const encodedUpdate = yjs.encodeUpdate(yjs.encodeFullState());
    queueCrdtUpdate(encodedUpdate);
  }, [queueCrdtUpdate]);

  const onLocalContentChange = useCallback(async (nextValue: string) => {
    const yjs = yjsRef.current;

    if (!yjs || yjs.isApplyingRemote()) {
      return;
    }

    const update = yjs.applyLocalText(nextValue);
    if (!update) {
      return;
    }

    const encodedUpdate = yjs.encodeUpdate(update);
    queueCrdtUpdate(encodedUpdate);

  }, [queueCrdtUpdate]);

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
      connectedPeerIds,
      diagnostics: {
        lastIdentityVerify,
        lastPeerDiscoveryAt,
        relayDial,
        realtimeCrdt,
        runtimeRollout,
      },
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
      connectedPeerIds,
      lastIdentityVerify,
      lastPeerDiscoveryAt,
      relayDial,
      realtimeCrdt,
      runtimeRollout,
      error,
      messages,
      onLocalContentChange,
      onCursorChange,
      sendChat,
    ]
  );
}