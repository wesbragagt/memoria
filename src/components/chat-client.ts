/**
 * Browser-side helpers for the chat UI: POST /api/chat and parse the SSE
 * response body into typed events. Talks ONLY to the same-origin endpoint —
 * never to OpenRouter, and never sees the API key. Shared by ChatModal and the
 * /chat page components.
 */
import type { StoredMessage } from "../client/chat-store";

export interface Source {
  slug: string;
  title: string;
  url: string;
}

export type ChatEvent =
  | { type: "status"; message: string }
  | { type: "token"; text: string }
  | { type: "sources"; sources: Source[] }
  | { type: "error"; message: string }
  | { type: "done" };

/**
 * Stream a chat completion. Yields ChatEvents as they arrive. Aborts when the
 * given signal fires. A 503 surfaces as a single `error` event.
 */
export async function* streamChat(
  messages: StoredMessage[],
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (res.status === 503) {
    yield { type: "error", message: "Chat is not configured." };
    return;
  }
  if (!res.ok || !res.body) {
    yield { type: "error", message: `Request failed (${res.status}).` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(5).trim()) as ChatEvent;
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
