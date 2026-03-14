"use client";

type RuntimeConnection = {
  id?: string;
  remotePeer?: { toString?: () => string };
  remoteAddr?: { toString?: () => string };
};

type RuntimeDiscoveredPeer = {
  id?: unknown;
  multiaddrs?: unknown[];
};

type RuntimeDialAttempt = {
  target: string;
  source: "peer-discovery";
  success: boolean;
  timestamp: number;
  error?: string;
};

type RuntimeSnapshot = {
  connectedPeerIds: string[];
  connectionCount: number;
  lastPeerDiscoveryAt: number | null;
};

type RuntimeNode = {
  dial?: (target: unknown) => Promise<unknown>;
  getConnections?: (peerId?: string) => RuntimeConnection[];
  addEventListener?: (type: string, listener: (event: Event) => void) => void;
  removeEventListener?: (type: string, listener: (event: Event) => void) => void;
};

type RuntimeOptions = {
  node: RuntimeNode;
  localPeerId?: string | null;
  refreshIntervalMs?: number;
  forceLocalRelayOnly: boolean;
  autoDial?: boolean;
  shouldAttemptTarget: (target: string) => boolean;
  onDialAttempt?: (attempt: RuntimeDialAttempt) => void;
  onSnapshot?: (snapshot: RuntimeSnapshot) => void;
};

function unique(values: string[]) {
  return Array.from(new Set(values));
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

function hasPeerIdInTarget(target: string) {
  return /\/p2p\/[A-Za-z0-9]+/.test(target);
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

  return normalized.includes("/p2p/") || normalized.includes("/dnsaddr/");
}

function isLocalhostTarget(target: string) {
  const normalized = target.toLowerCase();
  return (
    normalized.includes("/ip4/127.0.0.1/") ||
    normalized.includes("/dns4/localhost/")
  );
}

function extractDiscoveredPeer(event: Event) {
  return (
    event as Event & { detail?: RuntimeDiscoveredPeer }
  ).detail;
}

function getDiscoveredPeerIdLabel(discoveredPeer: RuntimeDiscoveredPeer) {
  const idLabel = toDialTargetLabel(discoveredPeer.id);
  return idLabel !== "unknown-target" ? idLabel : null;
}

function getDiscoveredDialTargets(options: {
  discoveredPeer: RuntimeDiscoveredPeer;
  forceLocalRelayOnly: boolean;
}) {
  const targets: string[] = [];
  const idLabel = toDialTargetLabel(options.discoveredPeer.id);

  if (Array.isArray(options.discoveredPeer.multiaddrs)) {
    for (const multiaddr of options.discoveredPeer.multiaddrs) {
      const label = toDialTargetLabel(multiaddr);
      if (label === "unknown-target") {
        continue;
      }

      const withPeerId =
        idLabel !== "unknown-target" && !hasPeerIdInTarget(label)
          ? `${label}/p2p/${idLabel}`
          : label;
      targets.push(withPeerId);
    }
  }

  const dialableTargets = unique(targets).filter(isImmediateDialCandidate);
  if (!options.forceLocalRelayOnly) {
    return dialableTargets;
  }

  return dialableTargets.filter(isLocalhostTarget);
}

function getConnectedPeerIds(node: RuntimeNode, localPeerId?: string | null) {
  const ids = (node.getConnections?.() || [])
    .map((connection) => connection.remotePeer?.toString?.() || null)
    .filter((peerId): peerId is string => Boolean(peerId));

  const deduped = unique(ids);
  if (!localPeerId) {
    return deduped;
  }

  return deduped.filter((peerId) => peerId !== localPeerId);
}

export class P2PRuntime {
  private readonly node: RuntimeNode;
  private readonly localPeerId?: string | null;
  private readonly refreshIntervalMs: number;
  private readonly forceLocalRelayOnly: boolean;
  private readonly autoDial: boolean;
  private readonly shouldAttemptTarget: (target: string) => boolean;
  private readonly onDialAttempt?: (attempt: RuntimeDialAttempt) => void;
  private readonly onSnapshot?: (snapshot: RuntimeSnapshot) => void;

  private readonly onPeerDiscoveryBound: (event: Event) => void;
  private readonly onPeerConnectBound: () => void;
  private readonly onPeerDisconnectBound: () => void;
  private readonly onConnectionOpenBound: () => void;
  private readonly onConnectionCloseBound: () => void;

  private refreshTimer: number | null = null;
  private lastPeerDiscoveryAt: number | null = null;

  constructor(options: RuntimeOptions) {
    this.node = options.node;
    this.localPeerId = options.localPeerId;
    this.refreshIntervalMs = options.refreshIntervalMs ?? 3_000;
    this.forceLocalRelayOnly = options.forceLocalRelayOnly;
    this.autoDial = options.autoDial ?? true;
    this.shouldAttemptTarget = options.shouldAttemptTarget;
    this.onDialAttempt = options.onDialAttempt;
    this.onSnapshot = options.onSnapshot;

    this.onPeerDiscoveryBound = this.onPeerDiscovery.bind(this);
    this.onPeerConnectBound = this.refreshConnections.bind(this);
    this.onPeerDisconnectBound = this.refreshConnections.bind(this);
    this.onConnectionOpenBound = this.refreshConnections.bind(this);
    this.onConnectionCloseBound = this.refreshConnections.bind(this);
  }

  start() {
    this.node.addEventListener?.("peer:discovery", this.onPeerDiscoveryBound);
    this.node.addEventListener?.("peer:connect", this.onPeerConnectBound);
    this.node.addEventListener?.("peer:disconnect", this.onPeerDisconnectBound);
    this.node.addEventListener?.("connection:open", this.onConnectionOpenBound);
    this.node.addEventListener?.("connection:close", this.onConnectionCloseBound);

    this.refreshConnections();
    this.refreshTimer = window.setInterval(() => {
      this.refreshConnections();
    }, this.refreshIntervalMs);
  }

  stop() {
    if (this.refreshTimer) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.node.removeEventListener?.("peer:discovery", this.onPeerDiscoveryBound);
    this.node.removeEventListener?.("peer:connect", this.onPeerConnectBound);
    this.node.removeEventListener?.("peer:disconnect", this.onPeerDisconnectBound);
    this.node.removeEventListener?.("connection:open", this.onConnectionOpenBound);
    this.node.removeEventListener?.("connection:close", this.onConnectionCloseBound);
  }

  refreshConnections() {
    const connectedPeerIds = getConnectedPeerIds(this.node, this.localPeerId);
    this.onSnapshot?.({
      connectedPeerIds,
      connectionCount: connectedPeerIds.length,
      lastPeerDiscoveryAt: this.lastPeerDiscoveryAt,
    });
  }

  private async onPeerDiscovery(event: Event) {
    const discoveredPeer = extractDiscoveredPeer(event);
    if (!discoveredPeer || !this.node.dial) {
      return;
    }

    this.lastPeerDiscoveryAt = Date.now();
    this.refreshConnections();

    if (!this.autoDial) {
      return;
    }

    const peerIdTarget = getDiscoveredPeerIdLabel(discoveredPeer);
    if (peerIdTarget && this.shouldAttemptTarget(`/p2p/${peerIdTarget}`)) {
      try {
        await this.node.dial(discoveredPeer.id);
        this.onDialAttempt?.({
          target: `/p2p/${peerIdTarget}`,
          source: "peer-discovery",
          success: true,
          timestamp: Date.now(),
        });
        return;
      } catch {
        this.onDialAttempt?.({
          target: `/p2p/${peerIdTarget}`,
          source: "peer-discovery",
          success: false,
          timestamp: Date.now(),
          error: "DIAL_FAILED",
        });
      }
    }

    const dialTargets = getDiscoveredDialTargets({
      discoveredPeer,
      forceLocalRelayOnly: this.forceLocalRelayOnly,
    });

    for (const target of dialTargets) {
      if (!this.shouldAttemptTarget(target)) {
        continue;
      }

      try {
        await this.node.dial(target);
        this.onDialAttempt?.({
          target,
          source: "peer-discovery",
          success: true,
          timestamp: Date.now(),
        });
        return;
      } catch {
        this.onDialAttempt?.({
          target,
          source: "peer-discovery",
          success: false,
          timestamp: Date.now(),
          error: "DIAL_FAILED",
        });
      }
    }
  }
}
