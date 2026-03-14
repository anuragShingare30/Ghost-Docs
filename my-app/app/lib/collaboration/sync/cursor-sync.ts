"use client";

import { CursorPayload } from "../types";

export function createCursorPayload(position: number): CursorPayload {
  return { position };
}
