import { auth } from "@clerk/nextjs/server";
import {
  apiError,
  apiSuccess,
  handleApiError,
  parseRequestJson,
  unauthorizedError,
} from "../../lib/api";
import { getOrCreateGhostId } from "../../lib/ghostid";
import { prisma } from "../../lib/prisma";

type CreateDocumentPayload = {
  title?: string;
  access?: "PRIVATE" | "LINK" | "PUBLIC";
};

const accessModeMap = {
  PRIVATE: true,
  LINK: true,
  PUBLIC: true,
} as const;

export async function GET(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return unauthorizedError();
    }

    const url = new URL(request.url);
    const page = Math.max(Number(url.searchParams.get("page") || 1) || 1, 1);
    const rawPageSize = Number(url.searchParams.get("pageSize") || 10) || 10;
    const pageSize = Math.min(Math.max(rawPageSize, 1), 50);
    const accessParam = (url.searchParams.get("access") || "").toUpperCase();
    const query = (url.searchParams.get("query") || "").trim();

    if (accessParam && !(accessParam in accessModeMap)) {
      return apiError("Invalid access filter.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const access = accessParam
      ? (accessParam as CreateDocumentPayload["access"])
      : undefined;

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });

    const where = {
      OR: [
        { access: "PUBLIC" as const },
        ...(user
          ? [{ ownerId: user.id }, { permissions: { some: { userId: user.id } } }]
          : []),
      ],
      ...(access ? { access } : {}),
      ...(query
        ? {
            title: {
              contains: query,
              mode: "insensitive" as const,
            },
          }
        : {}),
    };

    const total = await prisma.document.count({ where });

    const documents = await prisma.document.findMany({
      where,
      select: {
        id: true,
        title: true,
        access: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return apiSuccess(
      { documents },
      {
        meta: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
          access: access ?? null,
          query: query || null,
        },
      }
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return unauthorizedError();
    }

    const payload = await parseRequestJson<CreateDocumentPayload>(request);
    const title = payload.title?.trim();

    if (!title) {
      return apiError("Title is required.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const access = payload.access ?? "PRIVATE";
    if (!(access in accessModeMap)) {
      return apiError("Invalid access mode.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    await getOrCreateGhostId(userId);

    const owner = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });

    if (!owner) {
      return apiError("User not found.", { status: 404, code: "NOT_FOUND" });
    }

    const document = await prisma.document.create({
      data: {
        title,
        access,
        ownerId: owner.id,
        permissions: {
          create: {
            userId: owner.id,
            role: "OWNER",
          },
        },
        auditEvents: {
          create: {
            actorId: owner.id,
            eventType: "DOCUMENT_CREATED",
            metadata: { title },
          },
        },
      },
      select: {
        id: true,
        title: true,
        access: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return apiSuccess({ document }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
