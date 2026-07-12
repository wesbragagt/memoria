/**
 * /chat two-pane app: a thread list (all past conversations from IndexedDB)
 * beside the active conversation. New-thread button, click to switch. Same
 * ChatConversation component as the modal. client:only — pure browser state.
 */
import { useCallback, useEffect, useState } from "react";
import {
  createThread,
  latestThread,
  listThreads,
  type Thread,
} from "../client/chat-store";
import ChatConversation from "./ChatConversation";
import { ChatStyles } from "./chat-styles";

export default function ChatPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const all = await listThreads();
    setThreads(all);
    return all;
  }, []);

  useEffect(() => {
    (async () => {
      const all = await refresh();
      const latest = all[0] ?? (await latestThread());
      setActiveId(latest ? latest.id : (await createThread()).id);
      if (!latest) await refresh();
    })();
  }, [refresh]);

  const startNew = useCallback(async () => {
    const t = await createThread();
    await refresh();
    setActiveId(t.id);
  }, [refresh]);

  return (
    <div className="chat-page">
      <ChatStyles />
      <aside className="chat-threadlist">
        <div className="chat-threadlist-head">
          <strong>Conversations</strong>
          <button type="button" className="chat-newbtn" onClick={() => void startNew()}>
            New
          </button>
        </div>
        {threads.length === 0 && <p className="chat-empty">No conversations yet.</p>}
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chat-threaditem${t.id === activeId ? " active" : ""}`}
            onClick={() => setActiveId(t.id)}
            title={t.title}
          >
            {t.title}
          </button>
        ))}
      </aside>
      <section className="chat-pane">
        {activeId && (
          <ChatConversation
            threadId={activeId}
            onThreadUpdated={() => void refresh()}
          />
        )}
      </section>
    </div>
  );
}
