import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../app/lib/collaboration/sessions/session-manager";
import { encryptCollaborationPayload } from "../../app/lib/collaboration/crypto/message-encryption";
import { YjsSync } from "../../app/lib/collaboration/sync/yjs-sync";

vi.stubGlobal("window", {
  btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
  atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
});

class FakePubsub extends EventTarget {
  async subscribe() {
    return;
  }

  async unsubscribe() {
    return;
  }

  async publish(topic: string, data: Uint8Array) {
    void topic;
    void data;
    return;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 500) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createSessionOptions() {
  const pubsub = new FakePubsub();
  const sessionKey = "shared-doc-session-key";

  return {
    pubsub,
    sessionKey,
    session: new SessionManager({
      node: {
        start: async () => undefined,
        stop: async () => undefined,
        services: { pubsub },
      },
      identity: {
        ghostId: "ghost-local",
        peerId: "peer-local",
      },
      token: "local-peer-token",
      sessionKey,
      role: "OWNER",
      docId: "doc-editor",
      verifyToken: async () => ({ valid: true, role: "EDITOR" }),
    }),
  };
}

describe("editor collaboration event flow", () => {
  it("accepts remote identity + chat events and tracks peer presence", async () => {
    const { pubsub, session, sessionKey } = createSessionOptions();
    await session.join();

    const peerJoined = vi.fn();
    const messageEvent = vi.fn();

    session.addEventListener("peer:joined", peerJoined);
    session.addEventListener("message", messageEvent);

    const identityEnvelope = {
      messageType: "identity",
      peerId: "peer-remote",
      ghostId: "ghost-remote",
      timestamp: Date.now(),
      payload: {
        token: "peer-token",
      },
    };

    const encryptedIdentity = await encryptCollaborationPayload(
      sessionKey,
      "doc-editor",
      identityEnvelope
    );

    pubsub.dispatchEvent(
      new CustomEvent("message", {
        detail: {
          topic: session.getTopic(),
          from: { toString: () => "peer-remote" },
          data: new TextEncoder().encode(encryptedIdentity),
        },
      })
    );

    await waitFor(() => peerJoined.mock.calls.length === 1);

    expect(peerJoined).toHaveBeenCalledTimes(1);
    expect(session.getPeers()).toHaveLength(1);
    expect(session.getPeers()[0]?.peerId).toBe("peer-remote");

    const chatEnvelope = {
      messageType: "chat",
      peerId: "peer-remote",
      ghostId: "ghost-remote",
      timestamp: Date.now(),
      payload: {
        text: "hello from remote",
      },
    };

    const encryptedChat = await encryptCollaborationPayload(
      sessionKey,
      "doc-editor",
      chatEnvelope
    );

    pubsub.dispatchEvent(
      new CustomEvent("message", {
        detail: {
          topic: session.getTopic(),
          from: { toString: () => "peer-remote" },
          data: new TextEncoder().encode(encryptedChat),
        },
      })
    );

    await waitFor(() => messageEvent.mock.calls.length > 0);

    expect(messageEvent).toHaveBeenCalled();

    await session.shutdown();
  });

  it("applies remote CRDT updates that mirror editor content changes", () => {
    const origin = new YjsSync("hello");
    const replica = new YjsSync("");

    const update = origin.applyLocalText("hello world");
    expect(update).not.toBeNull();

    const encoded = origin.encodeUpdate(update as Uint8Array);
    const decoded = replica.decodeUpdate(encoded);
    const nextText = replica.applyRemoteUpdate(decoded);

    expect(nextText).toBe("hello world");
  });

  it("merges concurrent peer edits and converges to a shared state", () => {
    const peerA = new YjsSync("hello");
    const peerB = new YjsSync("hello");

    const updateA = peerA.applyLocalText("hello A");
    const updateB = peerB.applyLocalText("hello B");

    expect(updateA).not.toBeNull();
    expect(updateB).not.toBeNull();

    const updateAEncoded = peerA.encodeUpdate(updateA as Uint8Array);
    const updateBEncoded = peerB.encodeUpdate(updateB as Uint8Array);

    peerA.applyRemoteUpdate(peerA.decodeUpdate(updateBEncoded));
    peerB.applyRemoteUpdate(peerB.decodeUpdate(updateAEncoded));

    const finalA = peerA.getText();
    const finalB = peerB.getText();

    expect(finalA).toBe(finalB);
    expect(finalA).toContain("hello");
    expect(finalA).toContain("A");
    expect(finalA).toContain("B");
  });
});
