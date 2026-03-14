import { NextResponse } from "next/server";

export const API_VERSION = "v1";

type ApiSuccessOptions = {
  status?: number;
  meta?: Record<string, unknown>;
};

type ApiErrorOptions = {
  status?: number;
  code?: string;
  details?: unknown;
};

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error.";
}

export function apiSuccess<T>(data: T, options?: ApiSuccessOptions) {
  return NextResponse.json(
    {
      success: true,
      version: API_VERSION,
      data,
      ...(options?.meta ? { meta: options.meta } : {}),
    },
    { status: options?.status ?? 200 }
  );
}

export function apiError(message: string, options?: ApiErrorOptions) {
  return NextResponse.json(
    {
      success: false,
      version: API_VERSION,
      error: {
        message,
        ...(options?.code ? { code: options.code } : {}),
        ...(options?.details ? { details: options.details } : {}),
      },
    },
    { status: options?.status ?? 400 }
  );
}

export function unauthorizedError() {
  return apiError("Unauthorized", { status: 401, code: "UNAUTHORIZED" });
}

export function handleApiError(error: unknown) {
  const message = getErrorMessage(error);
  const status = message === "Invalid JSON body." ? 400 : 500;

  return apiError(message, {
    status,
    code: status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR",
  });
}

export async function parseRequestJson<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Invalid JSON body.");
  }
}
