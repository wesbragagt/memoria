/**
 * Ask-the-docs chat endpoint (SSE). Thin: parse the message list, gate on
 * configuration, and stream the agent's ChatEvents as Server-Sent Events. All
 * agent/LLM logic lives in the server-only adapter; the API key never leaves
 * the server.
 *
 * Contract:
 *   - Unconfigured (no OPENROUTER_API_KEY) → 503 {configured:false}.
 *   - Configured → 200 text/event-stream. Each frame is
 *       event: <status|token|sources|error|done>
 *       data: <JSON>
 */
import type { APIRoute } from "astro";
import {
  isConfigured,
  runAgent,
  type ChatEvent,
  type ChatMessage,
} from "../../adapters/chat-agent";

export const prerender = false;

function sseFrame(event: ChatEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const POST: APIRoute = async ({ request }) => {
  if (!isConfigured()) {
    return new Response(JSON.stringify({ configured: false }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  let messages: ChatMessage[] = [];
  try {
    const body = (await request.json()) as { messages?: unknown };
    if (Array.isArray(body.messages)) messages = body.messages as ChatMessage[];
  } catch {
    messages = [];
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runAgent(messages)) {
          controller.enqueue(encoder.encode(sseFrame(event)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Chat failed.";
        controller.enqueue(
          encoder.encode(sseFrame({ type: "error", message })),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
};
