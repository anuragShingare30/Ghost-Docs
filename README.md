# GhostDocs — Technical Architecture

GhostDocs is a privacy-first, decentralized collaborative document platform. This document translates the product architecture into a buildable technical architecture using:

- Next.js + TypeScript + Tailwind CSS
- Js-LibP2P SDK
- Neon (Postgres)
- Clerk (authentication)
- wagmi + viem + RainbowKit (wallet connect)

The system is designed to minimize central coordination, keep documents encrypted end-to-end, and rely on peer-to-peer collaboration for real-time editing.

---

## Build Order (What to Build First)

This order reduces risk by validating identity, permissions, and data model before real-time P2P complexity.

1. **Foundation (App + Auth + Wallet)**
	- Next.js app shell, routing, layout, and Tailwind setup.
	- Clerk authentication (email/social) and session handling.
	- Wallet connect using wagmi + viem + RainbowKit.
	- Define user identity model that maps Clerk user + wallet to a GhostID.

2. **Data Model + API (Neon + Minimal Backend)**
	- Neon Postgres schema for users, documents, permissions, share links, and audit events.
	- Minimal API routes in Next.js for access checks, link creation, and metadata retrieval.
	- Document metadata only (no plaintext content).

3. **Document Encryption + Storage Adapter**
	- Client-side encryption and key management flow.
	- Storage adapter interfaces (Fileverse or compatible storage) for encrypted blobs.
	- Version metadata stored in Neon, encrypted content stored externally.

4. **Collaboration Layer (JsLibP2P)**
	- Peer discovery, session join/leave, and presence.
	- Real-time sync for edits, cursors, and chat.
	- Session events emitted for collaboration state.
	- **Peer-to-peer editing**

5. **Access Verification + Sharing**
	- Permission checks integrated into session join.
	- Share links with scoped access and expiry.
	- Private / Link / Public document modes.

6. **Hardening + Observability**
	- Security review, rate limiting, abuse mitigation.
	- Analytics with minimal metadata.
	- Testing and reliability for offline/edge cases.

---

## Layered Technical Architecture

### 1) Client Layer (Next.js + TypeScript + Tailwind CSS)

**Responsibilities**

- UI for authentication, editor, sharing, collaboration, chat, and presence.
- Local encryption/decryption.
- P2P peer communication and session management.

**Core UI Modules**

- Dashboard
- Document Editor
- Sharing Panel
- Session Chat
- User Presence
- Settings

**Key Client Services**

- Identity SDK (GhostID generation)
- Crypto Service (encryption/decryption)
- P2P Session Client (LibP2P wrapper)
- Storage Adapter (upload/download encrypted blobs)

---

### 2) Identity Layer (Clerk + Wallet)

**Goal:** Provide privacy-preserving identity with wallet proof while avoiding public exposure of wallet addresses.

**Flow**

- User authenticates with Clerk.
- User optionally connects wallet via wagmi + RainbowKit.
- Backend generates a GhostID and binds it to Clerk user + wallet signature.
- Client uses GhostID for all collaboration sessions.

**Identity Artifacts**

- `GhostID`: anonymized user identifier
- `PeerID`: LibP2P node identity

---

### 3) Collaboration Layer (LibP2P)

**Goal:** Real-time decentralized collaboration without a central relay.

**Responsibilities**

- Peer discovery and session join.
- Real-time document sync.
- Presence and cursor tracking.
- Live chat and session events.

**Session Data**

- Editing updates
- Cursor positions
- Chat messages
- Presence state

---

### 4) Storage Layer (Encrypted Blobs + Fileverse Adapter)

**Goal:** Never store plaintext content. Encrypted blobs only.

**Responsibilities**

- Encrypt documents locally before upload.
- Store encrypted content in external storage.
- Store version metadata in Neon.

**Storage Flow**

- Document content
- Client-side encryption
- Encrypted blob upload
- Version metadata saved

---

### 5) Verification / Access Layer (Neon + API)

**Goal:** Control access without revealing identity or storing plaintext.

**Responsibilities**

- Document ownership and permission registry.
- Link-based access validation.
- Join-time access verification.

**Access Modes**

- Private Document
- Link Access Document
- Public Document

---

## Backend Architecture (Minimal Coordination Layer)

GhostDocs uses a minimal backend for metadata and access verification only.

**Services**

- Identity Manager
- Document Access Service
- Link and Permission Generator

**Neon Data Model (Suggested)**

- `users` (clerk_id, ghost_id, wallet_address_hash)
- `documents` (doc_id, owner_ghost_id, title, created_at)
- `document_versions` (doc_id, version_id, storage_uri, created_at)
- `permissions` (doc_id, ghost_id, role)
- `share_links` (doc_id, token, access_level, expires_at)
- `audit_events` (doc_id, event_type, created_at)

No plaintext content is stored in Neon.

---

## Security and Privacy Model

- End-to-end encryption for document content.
- Minimal metadata storage.
- GhostID-based collaboration, no wallet address exposure.
- Link access with scoped permissions and expiration.
- P2P collaboration to reduce central traffic.

---

## Data Flow (Share + Collaborate)

1. User creates document.
2. Client encrypts locally and uploads encrypted blob.
3. Metadata stored in Neon.
4. User generates share link.
5. Peer opens link and passes access check.
6. LibP2P session established and peers sync edits.

---

## Key Engineering Decisions

- **Next.js** for UI, API routes, and deployment simplicity.
- **LibP2P** for decentralized collaboration.
- **Neon** for reliable metadata storage and access control.
- **Clerk** for secure authentication and session management.
- **wagmi + viem + RainbowKit** for wallet-based identity binding.

---

## Next Implementation Milestones

1. Define Neon schema and API routes for identity + permissions.
2. Implement GhostID generation and binding flow.
3. Build encrypted document create/upload and version metadata.
4. Add LibP2P session layer with presence and chat.
5. Wire access checks into session join and link sharing.

---

## Implementation Status And Build Order (Live)

This section reflects implementation progress in the current codebase and the recommended execution order for remaining work.

### Phase 1: Foundation (App + Auth + Wallet)

**Status: Completed (Core)**

Already implemented:

- Next.js app shell, routing, and Tailwind styling baseline.
- Clerk authentication integrated with protected routes (`/dashboard`, `/editor/[id]`).
- wagmi + viem + RainbowKit wallet connect integrated.
- Auto wallet reconnect disabled (`reconnectOnMount=false`) to avoid unintended auto-connect.
- GhostID creation + wallet link APIs and UI actions.
- Dashboard identity status card reading persisted GhostID and wallet from backend.

Remaining in this phase:

- Add wallet signature verification step before wallet link persistence (security hardening).
- Add auth/wallet edge-case UX polish (expired sessions, reconnect prompts, error toasts).

---

### Phase 2: Data Model + API (Neon + Minimal Backend)

**Status: Completed (MVP)**

Already implemented:

- Prisma/Neon data model for:
	- users
	- documents
	- document_versions
	- permissions
	- share_links
	- audit_events
- Minimal API routes for:
	- GhostID create/read
	- Wallet link persistence
	- Document create/list
	- Metadata retrieval
	- Access checks
	- Share link creation
- Server utility layer and centralized API error handling for current routes.
- Metadata-only persistence model (no plaintext document body stored in Neon).
- API contract/versioning with standardized `v1` response envelope (`success`, `version`, `data`/`error`, optional `meta`).
- Rate limiting/abuse controls on share-link creation and access-check endpoints.
- Pagination and filtering for document listing (`page`, `pageSize`, `access`, `query`).
- Prisma seed script + migration validation scripts + CI workflow for schema/migration drift checks.

Remaining in this phase:

- Add stricter API schema validation (runtime validators) across all request payloads.
- Add persistent/distributed rate limit backing (Redis or database) for multi-instance deployments.

---

### Phase 3: Document Encryption + Storage Adapter

**Status: Not Started**

To implement:

- Client-side document encryption/decryption pipeline.
- Key management strategy (per-document keys, key wrapping, sharing flow).
- Storage adapter integration for encrypted blobs (Fileverse-compatible abstraction).
- Persist encrypted blob references in `document_versions.storageUri`.
- Upload/download/recovery error handling and retry strategy.

---

### Phase 4: Collaboration Layer (LibP2P)

**Status: Not Started**

To implement:

- Peer discovery + session establishment.
- Real-time sync protocol for edits/cursors/presence/chat.
- Session join/leave and peer reconnection flows.
- Session-level authorization handshake tied to access checks.

---

### Phase 5: Access Verification + Sharing

**Status: Partially Completed**

Already implemented:

- Access modes in data model (`PRIVATE`, `LINK`, `PUBLIC`).
- Link token creation and expiration support.
- Metadata and access-check endpoints with ownership/permission validation.

Remaining:

- Enforce access verification inside live LibP2P session join flow.
- Add permission management APIs/UI (grant/revoke editor/viewer).
- Add link revocation and one-time/scoped link options.

---

### Phase 6: Hardening + Observability

**Status: Not Started**

To implement:

- Structured logging with request IDs and error categories.
- API rate limiting and suspicious activity protection.
- Security checks (signature validation, replay protection, input sanitization review).
- E2E/integration tests for auth, access, sharing, and failure paths.
- Performance and reliability tests for session scale and reconnect behavior.

---

## Recommended Build Order From Current State

1. Complete Phase 3 (Encryption + Storage adapter), because collaboration must never operate on plaintext persisted state.
2. Implement Phase 4 (LibP2P core session protocol) with minimal editor sync + presence first.
3. Finish Phase 5 integration by enforcing access checks during P2P session handshake.
4. Execute Phase 6 hardening and test coverage before production usage.

## Definition Of Done For Current Milestone

Current milestone (Foundation + Data Model/API) is considered done when:

- GhostID can be created and read back from Neon.
- Wallet can be linked and reflected on dashboard status.
- Protected routes enforce Clerk auth.
- Document metadata APIs create/list/check/share successfully with validated error responses.
