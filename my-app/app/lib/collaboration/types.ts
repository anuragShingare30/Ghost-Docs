export type CollaborationRole = "OWNER" | "EDITOR" | "VIEWER";

export type CollaborationIdentity = {
  ghostId: string;
  peerId: string;
  username?: string;
};

export type CollaborationMessageType =
  | "identity"
  | "presence"
  | "crdt-update"
  | "cursor"
  | "chat"
  | "heartbeat";

export type CollaborationEnvelope<T = unknown> = {
  messageType: CollaborationMessageType;
  peerId: string;
  ghostId: string;
  timestamp: number;
  payload: T;
};

export type IdentityPayload = {
  token: string;
  username?: string;
};

export type PresencePayload = {
  action: "join" | "leave" | "heartbeat";
};

export type CursorPayload = {
  position: number;
};

export type ChatPayload = {
  text: string;
};

export type CrdtUpdatePayload = {
  update: string;
};

export type SessionPeer = {
  peerId: string;
  ghostId: string;
  role: CollaborationRole;
  cursorPosition?: number;
  lastSeen: number;
};

export type CollaborationTokenPayload = {
  docId: string;
  ghostId: string;
  role: CollaborationRole;
  peerId: string;
  exp: number;
};
