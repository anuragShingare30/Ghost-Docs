import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authMock = vi.hoisted(() => vi.fn(async () => ({ userId: "clerk_1" })));
const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  document: {
    findUnique: vi.fn(),
  },
  permission: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("../../app/lib/prisma", () => ({
  prisma: prismaMock,
}));

describe("collaboration join/verify integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues join token for document owner and validates it via verify route", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", ghostId: "ghost-u1" });
    prismaMock.document.findUnique.mockResolvedValue({ ownerId: "u1", access: "PRIVATE" });

    const joinRoute = await import("../../app/api/collab/join/route");
    const verifyRoute = await import("../../app/api/collab/verify/route");

    const joinRequest = new Request("http://localhost/api/collab/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId: "doc_1", peerId: "peer_1" }),
    });

    const joinResponse = await joinRoute.POST(joinRequest);
    expect(joinResponse.status).toBe(200);

    const joinBody = (await joinResponse.json()) as {
      success: true;
      data: { token: string; docId: string; role: "OWNER" | "EDITOR" | "VIEWER" };
    };

    expect(joinBody.success).toBe(true);
    expect(joinBody.data.docId).toBe("doc_1");
    expect(joinBody.data.role).toBe("OWNER");

    const verifyRequest = new Request("http://localhost/api/collab/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: joinBody.data.token,
        docId: "doc_1",
        peerId: "peer_1",
        ghostId: "ghost-u1",
      }),
    });

    const verifyResponse = await verifyRoute.POST(verifyRequest);
    expect(verifyResponse.status).toBe(200);

    const verifyBody = (await verifyResponse.json()) as {
      success: true;
      data: { valid: boolean; role?: "OWNER" | "EDITOR" | "VIEWER" };
    };

    expect(verifyBody.success).toBe(true);
    expect(verifyBody.data.valid).toBe(true);
    expect(verifyBody.data.role).toBe("OWNER");
  });

  it("returns forbidden for users without document access", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u2", ghostId: "ghost-u2" });
    prismaMock.document.findUnique.mockResolvedValue({ ownerId: "u1", access: "PRIVATE" });
    prismaMock.permission.findFirst.mockResolvedValue(null);

    const joinRoute = await import("../../app/api/collab/join/route");

    const request = new Request("http://localhost/api/collab/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId: "doc_2", peerId: "peer_denied" }),
    });

    const response = await joinRoute.POST(request);
    expect(response.status).toBe(403);

    const body = (await response.json()) as {
      success: false;
      error: { code?: string; message: string };
    };

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
