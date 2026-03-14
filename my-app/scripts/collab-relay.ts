import path from "path";
import { readFile, writeFile } from "fs/promises";

function ensurePeerIdMultiaddr(multiaddr: string, peerId: string) {
  if (multiaddr.includes("/p2p/")) {
    return multiaddr;
  }
  return `${multiaddr}/p2p/${peerId}`;
}

async function main() {
  const [
    { createLibp2p },
    { webSockets },
    { noise },
    { yamux },
    { identify },
    { gossipsub },
    { circuitRelayServer },
    { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf },
  ] = await Promise.all([
    import("libp2p"),
    import("@libp2p/websockets"),
    import("@chainsafe/libp2p-noise"),
    import("@chainsafe/libp2p-yamux"),
    import("@libp2p/identify"),
    import("@chainsafe/libp2p-gossipsub"),
    import("@libp2p/circuit-relay-v2"),
    import("@libp2p/crypto/keys"),
  ]);

  const relayPort = Number(process.env.COLLAB_RELAY_PORT || "15002");
  const relayHost = process.env.COLLAB_RELAY_HOST || "0.0.0.0";
  const relayInfoPath = path.join(process.cwd(), ".collab-relay-info.json");
  const relayKeyPath = path.join(process.cwd(), ".collab-relay-key");

  let privateKey;

  try {
    const existingKey = await readFile(relayKeyPath, "utf8");
    privateKey = privateKeyFromProtobuf(Buffer.from(existingKey, "base64"));
  } catch {
    privateKey = await generateKeyPair("Ed25519");
    await writeFile(
      relayKeyPath,
      Buffer.from(privateKeyToProtobuf(privateKey)).toString("base64"),
      "utf8"
    );
  }

  const node = await createLibp2p({
    privateKey,
    addresses: {
      listen: [`/ip4/${relayHost}/tcp/${relayPort}/ws`],
    },
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify() as never,
      circuitRelay: circuitRelayServer() as never,
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }) as never,
    },
  });

  await node.start();

  const peerId = node.peerId.toString();
  const localhostTargets = [
    `/ip4/127.0.0.1/tcp/${relayPort}/ws/p2p/${peerId}`,
    `/dns4/localhost/tcp/${relayPort}/ws/p2p/${peerId}`,
  ];

  const targets = Array.from(new Set(localhostTargets));

  await writeFile(
    relayInfoPath,
    JSON.stringify(
      {
        peerId,
        startedAt: new Date().toISOString(),
        targets,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("[collab-relay] peer id:", peerId);
  console.log("[collab-relay] ws targets:");
  for (const target of targets) {
    console.log(`  - ${target}`);
  }
  console.log(`[collab-relay] relay info written to ${relayInfoPath}`);

  const shutdown = async () => {
    try {
      await node.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main();
