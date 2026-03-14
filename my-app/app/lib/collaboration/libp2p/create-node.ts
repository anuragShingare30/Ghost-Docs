"use client";

import type { PrivateKey } from "@libp2p/interface";

const DEFAULT_BOOTSTRAP_MULTIADDRS = [
  "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
  "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
];

const DEFAULT_ICE_SERVERS = ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"];

function parseIceServers(value: string | undefined) {
  const configured = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const urls = configured.length > 0 ? configured : DEFAULT_ICE_SERVERS;
  return [{ urls }];
}

function parseAddressList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectBootstrapList() {
  const isDevelopment = process.env.NODE_ENV !== "production";

  const seedNodesDev = parseAddressList(
    process.env.NEXT_PUBLIC_LIBP2P_SEED_NODES_DEV || process.env.NEXT_PUBLIC_LIBP2P_SEED_NODES
  );
  const seedNodesProd = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_SEED_NODES);
  const relayBootstrapDev = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_RELAY_BOOTSTRAP_ADDR_DEV);
  const relayBootstrapProd = parseAddressList(
    process.env.NEXT_PUBLIC_LIBP2P_RELAY_BOOTSTRAP_ADDR_PROD
  );
  const legacyBootstrap = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_BOOTSTRAP);

  const selected = isDevelopment
    ? relayBootstrapDev.length > 0
      ? relayBootstrapDev
      : seedNodesDev.length > 0
      ? seedNodesDev
      : legacyBootstrap.length > 0
      ? legacyBootstrap
      : DEFAULT_BOOTSTRAP_MULTIADDRS
    : seedNodesProd.length > 0
    ? seedNodesProd
    : relayBootstrapProd.length > 0
    ? relayBootstrapProd
    : legacyBootstrap.length > 0
    ? legacyBootstrap
    : DEFAULT_BOOTSTRAP_MULTIADDRS;

  return selected;
}

export type CollaborationNode = {
  peerId?: { toString?: () => string };
  start: () => Promise<void>;
  stop: () => Promise<void>;
  dial?: (target: unknown) => Promise<unknown>;
  getMultiaddrs?: () => Array<{ toString?: () => string }>;
  getConnections?: () => unknown[];
  addEventListener?: (type: string, listener: (event: Event) => void) => void;
  removeEventListener?: (type: string, listener: (event: Event) => void) => void;
  services: {
    pubsub: {
      subscribe: (topic: string) => Promise<void>;
      unsubscribe: (topic: string) => Promise<void>;
      publish: (
        topic: string,
        data: Uint8Array,
        options?: {
          allowPublishToZeroTopicPeers?: boolean;
        }
      ) => Promise<void>;
      addEventListener: (
        type: "message",
        listener: (event: Event) => void
      ) => void;
      removeEventListener: (
        type: "message",
        listener: (event: Event) => void
      ) => void;
    };
  };
};

export async function createCollaborationNode(privateKey: PrivateKey) {
  const [
    { createLibp2p },
    { webSockets },
    { webTransport },
    { webRTC, webRTCDirect },
    { circuitRelayTransport },
    { noise },
    { yamux },
    { identify, identifyPush },
    { dcutr },
    { autoNAT },
    { ping },
    { gossipsub },
    { bootstrap },
    { pubsubPeerDiscovery },
  ] =
    await Promise.all([
      import("libp2p"),
      import("@libp2p/websockets"),
      import("@libp2p/webtransport"),
      import("@libp2p/webrtc"),
      import("@libp2p/circuit-relay-v2"),
      import("@chainsafe/libp2p-noise"),
      import("@chainsafe/libp2p-yamux"),
      import("@libp2p/identify"),
      import("@libp2p/dcutr"),
      import("@libp2p/autonat"),
      import("@libp2p/ping"),
      import("@chainsafe/libp2p-gossipsub"),
      import("@libp2p/bootstrap"),
      import("@libp2p/pubsub-peer-discovery"),
    ]);

  const bootstrapList = selectBootstrapList();

  const discoveryTopic =
    process.env.NEXT_PUBLIC_LIBP2P_DISCOVERY_TOPIC ||
    "/ghostdocs/discovery/1.0.0";

  const rtcConfiguration = {
    iceServers: parseIceServers(process.env.NEXT_PUBLIC_LIBP2P_ICE_SERVERS),
  };

  const node = (await createLibp2p({
    privateKey: privateKey as unknown as PrivateKey,
    addresses: {
      listen: ["/p2p-circuit", "/webrtc", "/webtransport"],
    },
    connectionGater: {
      denyDialMultiaddr: () => false,
    },
    connectionManager: {
      autoDial: true,
      minConnections: 1,
      maxConnections: 32,
    },
    transports: [
      webSockets(),
      webTransport(),
      webRTC({ rtcConfiguration }),
      webRTCDirect({ rtcConfiguration }),
      circuitRelayTransport(),
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionManager: {
      autoDial: true,
      minConnections: 1,
      maxConnections: 128,
      inboundUpgradeTimeout: 30_000,
      outboundUpgradeTimeout: 30_000,
    },
    peerDiscovery: [
      bootstrap({ list: bootstrapList }),
      pubsubPeerDiscovery({
        interval: 3_000,
        topics: [discoveryTopic],
      }),
    ],
    services: {
      identify: identify() as never,
      identifyPush: identifyPush() as never,
      ping: ping() as never,
      autonat: autoNAT() as never,
      dcutr: dcutr() as never,
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
      }) as never,
    },
  })) as unknown as CollaborationNode;

  return node;
}
