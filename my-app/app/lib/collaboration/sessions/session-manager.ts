"use client";

import {
  CollaborationEnvelope,
  CollaborationIdentity,
  CollaborationMessageType,
  CollaborationRole,
  CrdtUpdatePayload,
  CursorPayload,
  ChatPayload,
  IdentityPayload,
  PresencePayload,
  SessionPeer,
} from "../types";
import type { CollaborationNode } from "../libp2p/create-node";
import {
  decryptCollaborationPayload,
  encryptCollaborationPayload,
} from "../crypto/message-encryption";
import { PresenceManager } from "../presence/presence-manager";
import { verifyCollabToken } from "./access-control";

type PubsubMessageEvent = Event & {
  detail?: {
    topic?: string;
    data?: Uint8Array;
    from?: { toString?: () => string };
  };
};

type IdentityVerifyEventDetail = {
  peerId: string;
  ghostId: string;
  valid: boolean;
  role?: CollaborationRole;
  timestamp: number;
  reason?: string;
};

function isNoTopicPeerError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("PublishError.NoPeersSubscribedToTopic")
  );
}

export class SessionManager extends EventTarget {
  private readonly node: CollaborationNode;
  private readonly identity: CollaborationIdentity;
  private readonly token: string;
  private readonly role: CollaborationRole;
  private readonly docId: string;
  private readonly topic: string;
  private readonly sessionSecret: string;
  private readonly presence: PresenceManager;
  private readonly peers: Map<string, SessionPeer>;
  private readonly verifyToken: typeof verifyCollabToken;
  private readonly announceRetryTimers: Array<ReturnType<typeof setTimeout>>;

  constructor(options: {
    node: CollaborationNode;
    identity: CollaborationIdentity;
    token: string;
    sessionKey?: string;
    role: CollaborationRole;
    docId: string;
    verifyToken?: typeof verifyCollabToken;
  }) {
    super();
    this.node = options.node;
    this.identity = options.identity;
    this.token = options.token;
    this.role = options.role;
    this.docId = options.docId;
    this.topic = `ghostdocs-doc-${options.docId}`;
    this.sessionSecret = options.sessionKey ?? options.token;
    this.presence = new PresenceManager();
    this.peers = new Map();
    this.verifyToken = options.verifyToken ?? verifyCollabToken;
    this.announceRetryTimers = [];
  }

  getTopic() {
    return this.topic;
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  async join() {
    await this.node.services.pubsub.subscribe(this.topic);

    this.node.services.pubsub.addEventListener("message", this.onMessage);

    this.dispatchEvent(
      new CustomEvent("session:joined", {
        detail: { topic: this.topic },
      })
    );

    await this.announceIdentityAndJoin();
    this.scheduleIdentityRetries();
  }

  async leave() {
    this.clearIdentityRetries();
    await this.publish("presence", this.presence.buildPresencePayload("leave"));
    this.node.services.pubsub.removeEventListener("message", this.onMessage);
    await this.node.services.pubsub.unsubscribe(this.topic);
  }

  async shutdown() {
    try {
      await this.leave();
    } catch {
      // Ignore leave errors during teardown.
    }

    if (this.node?.stop) {
      try {
        await this.node.stop();
      } catch {
        // Ignore node stop errors during teardown.
      }
    }
  }

  async heartbeat() {
    await this.publish("identity", {
      token: this.token,
      username: this.identity.username,
    } satisfies IdentityPayload);
    await this.publish("heartbeat", this.presence.buildPresencePayload("heartbeat"));
  }

  private async announceIdentityAndJoin() {
    await this.publish("identity", {
      token: this.token,
      username: this.identity.username,
    } satisfies IdentityPayload);

    await this.publish("presence", this.presence.buildPresencePayload("join"));
  }

  private scheduleIdentityRetries() {
    this.clearIdentityRetries();
    const retryDelaysMs = [2_000, 6_000, 12_000];

    for (const delayMs of retryDelaysMs) {
      const timerId = setTimeout(() => {
        void this.announceIdentityAndJoin();
      }, delayMs);
      this.announceRetryTimers.push(timerId);
    }
  }

  private clearIdentityRetries() {
    for (const timerId of this.announceRetryTimers) {
      clearTimeout(timerId);
    }
    this.announceRetryTimers.length = 0;
  }

  async publish(
    messageType: CollaborationMessageType,
    payload:
      | CrdtUpdatePayload
      | CursorPayload
      | ChatPayload
      | IdentityPayload
      | PresencePayload
  ) {
    const envelope: CollaborationEnvelope = {
      messageType,
      peerId: this.identity.peerId,
      ghostId: this.identity.ghostId,
      timestamp: Date.now(),
      payload,
    };

    const encrypted = await encryptCollaborationPayload(
      this.sessionSecret,
      this.docId,
      envelope
    );

    const encoded = new TextEncoder().encode(encrypted);

    try {
      await this.node.services.pubsub.publish(this.topic, encoded, {
        allowPublishToZeroTopicPeers: true,
      });
    } catch (error) {
      if (isNoTopicPeerError(error)) {
        // In sparse meshes, zero peers is expected temporarily.
        return;
      }
      throw error;
    }
  }

  private onMessage = async (event: Event) => {
    try {
      const detail = (event as PubsubMessageEvent).detail;
      if (!detail || detail.topic !== this.topic) {
        return;
      }

      const fromPeer = detail.from?.toString?.() || "";
      if (fromPeer === this.identity.peerId) {
        return;
      }

      const encrypted = new TextDecoder().decode(detail.data);
      const envelope = await decryptCollaborationPayload<CollaborationEnvelope>(
        this.sessionSecret,
        this.docId,
        encrypted
      );

      if (envelope.messageType === "identity") {
        const identityPayload = envelope.payload as IdentityPayload;
        const verification = await this.verifyToken({
          token: identityPayload.token,
          docId: this.docId,
          peerId: envelope.peerId,
          ghostId: envelope.ghostId,
        });

        const identityVerifyDetail: IdentityVerifyEventDetail = {
          peerId: envelope.peerId,
          ghostId: envelope.ghostId,
          valid: verification.valid,
          role: verification.role,
          timestamp: Date.now(),
          reason: verification.valid ? undefined : "TOKEN_VERIFICATION_FAILED",
        };

        this.dispatchEvent(
          new CustomEvent("identity:verify", {
            detail: identityVerifyDetail,
          })
        );

        if (!verification.valid) {
          return;
        }

        const peer: SessionPeer = {
          peerId: envelope.peerId,
          ghostId: envelope.ghostId,
          role: verification.role || "VIEWER",
          lastSeen: Date.now(),
        };

        this.peers.set(peer.peerId, peer);
        this.presence.upsertPeer(peer);
        this.dispatchEvent(new CustomEvent("peer:joined", { detail: peer }));

        // Re-announce locally so peers that subscribed late can still discover us.
        await this.publish("identity", {
          token: this.token,
          username: this.identity.username,
        } satisfies IdentityPayload);
      }

      if (envelope.messageType === "presence") {
        const payload = envelope.payload as PresencePayload;
        if (payload.action === "leave") {
          this.peers.delete(envelope.peerId);
          this.presence.removePeer(envelope.peerId);
          this.dispatchEvent(
            new CustomEvent("peer:left", { detail: { peerId: envelope.peerId } })
          );
        }

        if (payload.action === "heartbeat") {
          this.presence.updateHeartbeat(envelope.peerId);
          const peer = this.peers.get(envelope.peerId);
          if (peer) {
            this.dispatchEvent(new CustomEvent("peer:update", { detail: peer }));
          }
        }
      }

      this.dispatchEvent(new CustomEvent("message", { detail: envelope }));
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent("message:decrypt-failed", {
          detail: {
            timestamp: Date.now(),
            reason:
              error instanceof Error
                ? error.message
                : "MALFORMED_OR_UNREADABLE_MESSAGE",
          },
        })
      );
      // Ignore malformed/unreadable messages from unknown peers.
    }
  };
}
