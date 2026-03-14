import { apiError } from "./api";

type WindowEntry = {
  count: number;
  resetAt: number;
};

const windows = new Map<string, WindowEntry>();

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") || "unknown";
}

export function enforceRateLimit(options: {
  request: Request;
  keyPrefix: string;
  limit: number;
  windowMs: number;
}) {
  const ip = getClientIp(options.request);
  const key = `${options.keyPrefix}:${ip}`;
  const now = Date.now();
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }

  if (current.count >= options.limit) {
    return apiError("Rate limit exceeded. Please try again later.", {
      status: 429,
      code: "RATE_LIMITED",
      details: {
        retryAfterMs: current.resetAt - now,
      },
    });
  }

  current.count += 1;
  windows.set(key, current);
  return null;
}
