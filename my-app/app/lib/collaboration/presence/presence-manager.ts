"use client";

import { PresencePayload, SessionPeer } from "../types";

export class PresenceManager {
  private peers = new Map<string, SessionPeer>();

  upsertPeer(peer: SessionPeer) {
    this.peers.set(peer.peerId, peer);
  }

  removePeer(peerId: string) {
    this.peers.delete(peerId);
  }

  updateHeartbeat(peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) {
      return;
    }
    this.peers.set(peerId, { ...peer, lastSeen: Date.now() });
  }

  listPeers() {
    return Array.from(this.peers.values());
  }

  buildPresencePayload(action: PresencePayload["action"]): PresencePayload {
    return { action };
  }
}
