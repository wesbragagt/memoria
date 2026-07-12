/**
 * Header 💬 trigger + centered modal that resumes the reader's latest thread.
 * Mounted client:only (see Base.astro) because it depends on IndexedDB and has
 * no meaningful SSR output — server-rendering it would only produce a flash of
 * empty modal markup and force a hydration round-trip for a purely client-state
 * widget. The trigger is only present when chat is configured (Base omits the
 * island entirely when off), so this component assumes configured=true.
 *
 * Theming rides the site CSS variables, so themechange needs no handling here.
 */
import { useCallback, useEffect, useState } from "react";
import { createThread, latestThread } from "../client/chat-store";
import ChatConversation from "./ChatConversation";
import { ChatStyles } from "./chat-styles";

export default function ChatModal() {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);

  // Resume the latest thread (or start a fresh one) when first opened.
  const ensureThread = useCallback(async () => {
    if (threadId) return;
    const latest = await latestThread();
    setThreadId(latest ? latest.id : (await createThread()).id);
  }, [threadId]);

  useEffect(() => {
    if (open) void ensureThread();
  }, [open, ensureThread]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const startNew = useCallback(async () => {
    const t = await createThread();
    setThreadId(t.id);
  }, []);

  return (
    <>
      <ChatStyles />
      <button
        type="button"
        className="chat-trigger"
        aria-label="Ask the docs"
        onClick={() => setOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>Ask</span>
      </button>

      {open && (
        <div
          className="chat-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="chat-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Ask the docs"
          >
            <div className="chat-modal-head">
              <span className="chat-modal-title">Ask the docs</span>
              <div className="chat-modal-actions">
                <button type="button" className="chat-newbtn" onClick={() => void startNew()}>
                  New
                </button>
                <button
                  type="button"
                  className="chat-closebtn"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            {threadId && <ChatConversation threadId={threadId} />}
          </div>
        </div>
      )}
    </>
  );
}
