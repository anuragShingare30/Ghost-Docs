"use client";

import { ChatPayload } from "../types";

export function createChatPayload(text: string): ChatPayload {
  return { text };
}
