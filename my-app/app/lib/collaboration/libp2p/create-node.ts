"use client";

import type { PrivateKey } from "@libp2p/interface";

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
    { webRTC },
    { circuitRelayTransport },
    { noise },
    { yamux },
    { identify },
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
      import("@chainsafe/libp2p-gossipsub"),
      import("@libp2p/bootstrap"),
      import("@libp2p/pubsub-peer-discovery"),
    ]);

  const configuredBootstrapList = (process.env.NEXT_PUBLIC_LIBP2P_BOOTSTRAP || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const bootstrapList =
    configuredBootstrapList.length > 0
      ? configuredBootstrapList
      : ["/dnsaddr/bootstrap.libp2p.io"];

  const discoveryTopic =
    process.env.NEXT_PUBLIC_LIBP2P_DISCOVERY_TOPIC ||
    "/ghostdocs/discovery/1.0.0";

  const node = (await createLibp2p({
    privateKey: privateKey as unknown as PrivateKey,
    addresses: {
      listen: ["/p2p-circuit", "/webrtc", "/webtransport"],
    },
    connectionGater: {
      denyDialMultiaddr: () => false,
    },
    transports: [
      webSockets(),
      webTransport(),
      webRTC(),
      circuitRelayTransport(),
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      bootstrap({ list: bootstrapList }),
      pubsubPeerDiscovery({
        interval: 10_000,
        topics: [discoveryTopic],
      }),
    ],
    services: {
      identify: identify() as never,
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true,
      }) as never,
    },
  })) as unknown as CollaborationNode;

  return node;
}
