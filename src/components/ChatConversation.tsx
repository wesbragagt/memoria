/**
 * Active-thread conversation view: message transcript + composer. Owns the send
 * loop (persist user msg → stream assistant answer → persist it) and renders
 * status notes, streamed markdown, and citation links. Reused by both the
 * header modal and the /chat page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendToThread,
  getThread,
  type StoredMessage,
  type Thread,
} from "../client/chat-store";
import { streamChat, type Source } from "./chat-client";
import { renderMarkdown } from "./markdown";

interface Props {
  threadId: string;
  /** Notify parent (list view) that a thread changed, to refresh ordering. */
  onThreadUpdated?: (thread: Thread) => void;
}

export default function ChatConversation({ threadId, onThreadUpdated }: Props) {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load persisted thread whenever the selected thread changes.
  useEffect(() => {
    let cancelled = false;
    setAnswer("");
    setSources([]);
    setStatus(null);
    setError(null);
    getThread(threadId).then((t) => {
      if (!cancelled) setMessages(t?.messages ?? []);
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [threadId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, answer, status]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError(null);
    setStatus(null);
    setAnswer("");
    setSources([]);

    const userMsg: StoredMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    const afterUser = await appendToThread(threadId, userMsg);
    onThreadUpdated?.(afterUser);

    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let acc = "";
    let collectedSources: Source[] = [];
    try {
      for await (const ev of streamChat(nextMessages, controller.signal)) {
        if (ev.type === "status") setStatus(ev.message);
        else if (ev.type === "token") {
          acc += ev.text;
          setAnswer(acc);
        } else if (ev.type === "sources") {
          collectedSources = ev.sources;
          setSources(ev.sources);
        } else if (ev.type === "error") {
          setError(ev.message);
        } else if (ev.type === "done") {
          break;
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Chat failed.");
      }
    } finally {
      setStreaming(false);
      setStatus(null);
      abortRef.current = null;
    }

    if (acc) {
      const assistantMsg: StoredMessage = { role: "assistant", content: acc };
      const updated = await appendToThread(threadId, assistantMsg);
      setMessages(updated.messages);
      onThreadUpdated?.(updated);
      setAnswer("");
      // keep sources visible on the persisted turn via message render below
      void collectedSources;
    }
  }, [input, streaming, messages, threadId, onThreadUpdated]);

  return (
    <div className="chat-conversation">
      <div className="chat-transcript" ref={scrollRef}>
        {messages.length === 0 && !streaming && (
          <p className="chat-empty">Ask a question about the docs.</p>
        )}
        {messages.map((m, idx) => (
          <div key={idx} className={`chat-msg chat-msg-${m.role}`}>
            {m.role === "assistant" ? (
              <div
                className="chat-md"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
              />
            ) : (
              <div className="chat-text">{m.content}</div>
            )}
          </div>
        ))}
        {status && <div className="chat-status">{status}</div>}
        {sources.length > 0 && (
          <div className="chat-sources">
            <span className="chat-sources-label">Sources:</span>
            {sources.map((s) => (
              <a key={s.slug} href={s.url} className="chat-source-link">
                {s.title}
              </a>
            ))}
          </div>
        )}
        {answer && (
          <div className="chat-msg chat-msg-assistant">
            <div
              className="chat-md"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
            />
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
      </div>

      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          className="chat-input"
          value={input}
          placeholder="Ask the docs…"
          rows={1}
          disabled={streaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className="chat-send"
          disabled={streaming || input.trim() === ""}
        >
          {streaming ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
