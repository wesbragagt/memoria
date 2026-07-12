import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent, type ChatEvent } from "../src/adapters/chat-agent";
import { cleanup, tempDir, writeDoc } from "./helpers";

/**
 * Build a fake OpenRouter SSE Response body from a list of chat-completion
 * chunks. Each chunk becomes one `data: {json}\n\n` frame; a `[DONE]` frame
 * terminates the stream, matching the wire format the parser expects.
 */
function sseResponse(chunks: unknown[]): Response {
  const encoder = new TextEncoder();
  const frames =
    chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
    "data: [DONE]\n\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** One assistant chunk requesting a single tool call. */
function toolCallChunk(id: string, name: string, args: object) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

/** An assistant chunk emitting a text token. */
function tokenChunk(text: string, finish: string | null = null) {
  return { choices: [{ delta: { content: text }, finish_reason: finish }] };
}

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

let root: string;
const SAVE = ["DOCS_DIR", "OPENROUTER_API_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  root = await tempDir("memoria-chat-");
  await writeDoc(
    root,
    "install.md",
    "# Installation\n\nRun `npm install` then `npm run build`.\n",
  );
  saved = {};
  for (const k of SAVE) saved[k] = process.env[k];
  process.env.DOCS_DIR = root;
  process.env.OPENROUTER_API_KEY = "test-key";
});

afterEach(async () => {
  for (const k of SAVE) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  await cleanup(root);
});

describe("runAgent — search → read → cite flow", () => {
  it("calls search_docs, then read_doc, emits sources before tokens, ends with done", async () => {
    // Scripted model turns:
    //  1) request search_docs
    //  2) request read_doc for the found slug
    //  3) final answer text
    const responses = [
      sseResponse([toolCallChunk("c1", "search_docs", { query: "install" })]),
      sseResponse([toolCallChunk("c2", "read_doc", { slug: "install" })]),
      sseResponse([
        tokenChunk("Run "),
        tokenChunk("npm install", "stop"),
      ]),
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => responses[call++]);
    vi.stubGlobal("fetch", fetchMock);

    const events = await collect(runAgent([{ role: "user", content: "how to install?" }]));

    // The model was asked three times (search round, read round, answer round).
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const types = events.map((e) => e.type);
    // search status, read status, then sources, then tokens, then done.
    expect(types).toContain("status");
    expect(types).toContain("sources");
    expect(types).toContain("token");
    expect(types[types.length - 1]).toBe("done");

    // Sources must be emitted BEFORE any token event.
    const firstSources = types.indexOf("sources");
    const firstToken = types.indexOf("token");
    expect(firstSources).toBeGreaterThanOrEqual(0);
    expect(firstSources).toBeLessThan(firstToken);

    // The consulted doc surfaces as a citation with the right title/url.
    const sourcesEvent = events.find((e) => e.type === "sources");
    expect(sourcesEvent).toBeDefined();
    if (sourcesEvent?.type === "sources") {
      expect(sourcesEvent.sources.map((s) => s.slug)).toContain("install");
      const src = sourcesEvent.sources.find((s) => s.slug === "install");
      expect(src?.title).toBe("Installation");
      expect(src?.url).toBe("/docs/install");
    }

    // Answer text streamed through.
    const answer = events
      .filter((e): e is Extract<ChatEvent, { type: "token" }> => e.type === "token")
      .map((e) => e.text)
      .join("");
    expect(answer).toContain("npm install");
  });
});

describe("runAgent — step cap", () => {
  it("cuts off a model that always requests tools and still ends with done", async () => {
    // Model requests search_docs on EVERY tool-enabled round. The agent must
    // stop after MAX_TOOL_ROUNDS and force a final tool-less answer round.
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as { body: string }).body) as {
        tools?: unknown;
      };
      // The forced final round disables tools → return a text answer.
      if (!body.tools) {
        return sseResponse([tokenChunk("final answer", "stop")]);
      }
      return sseResponse([toolCallChunk("c", "search_docs", { query: "x" })]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const events = await collect(runAgent([{ role: "user", content: "loop please" }]));

    // 6 tool rounds + 1 forced final answer round = 7 model calls.
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(events[events.length - 1].type).toBe("done");
    const answer = events
      .filter((e): e is Extract<ChatEvent, { type: "token" }> => e.type === "token")
      .map((e) => e.text)
      .join("");
    expect(answer).toContain("final answer");
  });
});
