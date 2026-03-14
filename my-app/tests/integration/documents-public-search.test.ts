import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn(async () => ({ userId: "clerk_public" })));
const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  document: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("../../app/lib/prisma", () => ({
  prisma: prismaMock,
}));

describe("documents public search integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns public documents for authenticated users without local profile", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.document.count.mockResolvedValue(1);
    prismaMock.document.findMany.mockResolvedValue([
      {
        id: "doc_public_1",
        title: "Public Knowledge Base",
        access: "PUBLIC",
        createdAt: new Date("2026-03-10T10:00:00.000Z"),
        updatedAt: new Date("2026-03-10T10:00:00.000Z"),
      },
    ]);

    const route = await import("../../app/api/documents/route");
    const request = new Request(
      "http://localhost/api/documents?page=1&pageSize=10&access=PUBLIC&query=knowledge"
    );

    const response = await route.GET(request);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: true;
      data: {
        documents: Array<{ id: string; title: string; access: string }>;
      };
      meta: {
        total: number;
        access: string | null;
        query: string | null;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.documents).toHaveLength(1);
    expect(body.data.documents[0]?.access).toBe("PUBLIC");
    expect(body.meta.total).toBe(1);
    expect(body.meta.access).toBe("PUBLIC");
    expect(body.meta.query).toBe("knowledge");
  });
});
