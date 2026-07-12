/**
 * Server-only Ask-the-docs chat agent.
 *
 * Talks to OpenRouter's OpenAI-compatible chat-completions HTTP API directly
 * over fetch (streaming SSE body). No Vercel AI SDK, no extra deps. The agent
 * exposes two tools backed by the live docs domain:
 *   - search_docs(query) → top hits {slug, title, snippet}
 *   - read_doc(slug)     → {title, body} (truncated when very long)
 *
 * The domain search (searchDocs/getDoc) reads the filesystem at request time,
 * so tool results always reflect current doc content. NOTE: the reference
 * design mentioned a qmd/SQLite BM25 index and a vector flag for retrieval —
 * that is superseded here by the live domain search (always current, zero
 * index to maintain), per the orchestrator's stack decision.
 *
 * SECRETS: OPENROUTER_API_KEY is read only in this server module and never
 * leaves the server. isConfigured() lets entrypoints gate on its presence
 * without exposing the value.
 */
import { searchDocs, getDoc } from "../domain/docs";

/** Chat message as exchanged with the client and OpenRouter. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages that requested tool calls. */
  tool_calls?: ToolCall[];
  /** Present on tool result messages — echoes the call id it answers. */
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A doc the agent actually consulted, surfaced to the UI as a citation. */
export interface Source {
  slug: string;
  title: string;
  url: string;
}

/**
 * Server-Sent Events the endpoint streams to the browser. One JSON object per
 * `data:` line, tagged by `event:`.
 *   status  — human-facing progress note ("searching…", "reading <slug>")
 *   token   — a delta of streamed answer text
 *   sources — docs consulted, emitted before/with the answer for citations
 *   error   — fatal error; stream ends after
 *   done    — normal completion; stream ends after
 */
export type ChatEvent =
  | { type: "status"; message: string }
  | { type: "token"; text: string }
  | { type: "sources"; sources: Source[] }
  | { type: "error"; message: string }
  | { type: "done" };

/** Max tool rounds before the agent is forced to answer with what it has. */
const MAX_TOOL_ROUNDS = 6;
/** read_doc truncation ceiling (chars) — keeps context windows sane. */
const MAX_DOC_CHARS = 12_000;
/** search_docs result cap. */
const SEARCH_LIMIT = 8;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-3.5-haiku";

function apiKey(): string | undefined {
  const k = process.env.OPENROUTER_API_KEY?.trim();
  return k ? k : undefined;
}

function model(): string {
  return process.env.DOCS_AI_MODEL?.trim() || DEFAULT_MODEL;
}

/** True when an OpenRouter key is present. Read at call time. */
export function isConfigured(): boolean {
  return apiKey() !== undefined;
}

const SYSTEM_PROMPT = `You are the documentation assistant for this site. Answer strictly from the documentation, never from prior knowledge or invention.

Discipline you MUST follow:
1. To answer any substantive question, first call search_docs to find candidate docs, then call read_doc to read the FULL relevant doc(s). Search snippets alone are NOT enough to answer — you must read_doc before giving a substantive answer.
2. If, after searching and reading, the answer is not present in the docs, say plainly: "I couldn't find that in the docs." Do not guess or fabricate.
3. Cite the docs you consulted. Refer to them by their title; the UI renders clickable links from the sources it tracks.
4. Answer in concise Markdown.

Tools:
- search_docs(query): returns up to ${SEARCH_LIMIT} matching docs with slug, title, and a snippet.
- read_doc(slug): returns the full body of one doc (may be truncated if very long).`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_docs",
      description:
        "Search the documentation for relevant docs. Returns matching docs with slug, title, and a short snippet. Snippets are for locating docs, not for answering.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_doc",
      description:
        "Read the full body of a single doc by its slug (as returned by search_docs). Read the relevant doc(s) before answering substantively.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Doc slug from search_docs." },
        },
        required: ["slug"],
      },
    },
  },
] as const;

// --- Tool execution against the live docs domain ---------------------------

async function runSearchDocs(query: string): Promise<string> {
  const hits = (await searchDocs(query)).slice(0, SEARCH_LIMIT);
  const out = hits.map((h) => ({
    slug: h.doc.slug,
    title: h.doc.title,
    snippet: h.snippet,
  }));
  return JSON.stringify({ results: out });
}

async function runReadDoc(slug: string): Promise<string> {
  const doc = await getDoc(slug);
  if (!doc) return JSON.stringify({ error: "not_found", slug });
  let body = doc.body;
  let truncated = false;
  if (body.length > MAX_DOC_CHARS) {
    body = body.slice(0, MAX_DOC_CHARS);
    truncated = true;
  }
  return JSON.stringify({
    slug: doc.slug,
    title: doc.title,
    body,
    truncated,
    ...(truncated ? { note: "Body truncated; ask to read more if needed." } : {}),
  });
}

// --- OpenRouter SSE parsing -------------------------------------------------

interface Delta {
  content?: string;
  tool_calls?: {
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }[];
}

interface StreamOutcome {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
}

/**
 * POST one chat-completions request with stream:true, parse the SSE body,
 * accumulate assistant text and any tool-call deltas. `onToken` fires for each
 * content delta so the caller can forward tokens live.
 */
async function streamCompletion(
  messages: ChatMessage[],
  allowTools: boolean,
  onToken: (text: string) => void,
): Promise<StreamOutcome> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model(),
      messages,
      stream: true,
      ...(allowTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let content = "";
  let finishReason: string | null = null;
  // tool calls accumulate across deltas, keyed by their streamed index.
  const partial = new Map<number, { id: string; name: string; args: string }>();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by blank lines; process complete lines only.
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "" ) continue;
      if (data === "[DONE]") {
        buffer = "";
        break;
      }
      let json: {
        choices?: { delta?: Delta; finish_reason?: string | null }[];
      };
      try {
        json = JSON.parse(data);
      } catch {
        continue; // ignore keep-alive comments / partial garbage
      }
      const choice = json.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        onToken(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const cur =
          partial.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        partial.set(tc.index, cur);
      }
    }
  }

  const toolCalls: ToolCall[] = [...partial.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({
      id: c.id || `call_${c.name}`,
      type: "function" as const,
      function: { name: c.name, arguments: c.args },
    }));

  return { content, toolCalls, finishReason };
}

// --- Agent loop -------------------------------------------------------------

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Run the full agent loop for a conversation, yielding ChatEvents. Callers
 * (the SSE route) serialize each event onto the wire. Precondition:
 * isConfigured() is true.
 *
 * Loop: up to MAX_TOOL_ROUNDS times, ask the model with tools enabled; if it
 * requests tools, execute them (emitting status + tracking sources) and feed
 * results back. When the model answers (no tool calls) its text is streamed as
 * `token` events. On hitting the cap, a final round runs with tools disabled to
 * force a text answer.
 */
export async function* runAgent(
  userMessages: ChatMessage[],
): AsyncGenerator<ChatEvent> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    // Only user/assistant turns from the client are trusted for content.
    ...userMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: String(m.content ?? "") })),
  ];

  // Track consulted docs (searched or read) in first-seen order for citations.
  const sources = new Map<string, Source>();
  const noteSource = (slug: string, title: string) => {
    if (!sources.has(slug)) {
      sources.set(slug, { slug, title, url: `/docs/${slug}` });
    }
  };

  // Per-request token queue: streamCompletion's onToken (sync) pushes here and
  // the generator drains it in order. Local, so concurrent requests don't mix.
  const tokens: string[] = [];

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const lastRound = round === MAX_TOOL_ROUNDS;
      const allowTools = !lastRound;

      // On the final forced round, nudge the model to answer with what it has.
      if (lastRound) {
        messages.push({
          role: "user",
          content:
            "You have reached the tool-use limit. Answer now using only what you have already read, or say you couldn't find it in the docs.",
        });
      }

      let streamedAny = false;
      const outcome = await streamCompletion(messages, allowTools, (text) => {
        streamedAny = true;
        tokens.push(text);
      });

      if (allowTools && outcome.toolCalls.length > 0) {
        // Tool-requesting round: any incidental text is dropped (not an answer);
        // clear the token buffer before executing tools.
        tokens.length = 0;
        // Record the assistant's tool-call turn verbatim so the follow-up
        // request has matching tool_call_id references.
        messages.push({
          role: "assistant",
          content: outcome.content,
          tool_calls: outcome.toolCalls,
        });

        for (const call of outcome.toolCalls) {
          const args = parseArgs(call.function.arguments);
          let result: string;
          if (call.function.name === "search_docs") {
            const query = String(args.query ?? "");
            yield { type: "status", message: `searching “${query}”…` };
            result = await runSearchDocs(query);
            // Note every hit as a candidate source.
            try {
              const parsed = JSON.parse(result) as {
                results?: { slug: string; title: string }[];
              };
              for (const r of parsed.results ?? []) noteSource(r.slug, r.title);
            } catch {
              /* ignore */
            }
          } else if (call.function.name === "read_doc") {
            const slug = String(args.slug ?? "");
            yield { type: "status", message: `reading ${slug}…` };
            result = await runReadDoc(slug);
            try {
              const parsed = JSON.parse(result) as {
                slug?: string;
                title?: string;
                error?: string;
              };
              if (!parsed.error && parsed.slug && parsed.title) {
                noteSource(parsed.slug, parsed.title);
              }
            } catch {
              /* ignore */
            }
          } else {
            result = JSON.stringify({ error: "unknown_tool" });
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
        continue; // next round with tool results in context
      }

      // No tool calls: this is the answer. Emit citations BEFORE the answer
      // text so the UI can render the source links alongside it, then flush the
      // buffered token deltas in order.
      if (sources.size > 0) {
        yield { type: "sources", sources: [...sources.values()] };
      }
      while (tokens.length) yield { type: "token", text: tokens.shift() as string };
      if (!streamedAny && outcome.content) {
        yield { type: "token", text: outcome.content };
      }
      yield { type: "done" };
      return;
    }
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : "Chat failed.",
    };
    return;
  }

  // Unreachable: the final round always returns. Defensive done.
  yield { type: "done" };
}
