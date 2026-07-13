/**
 * Chat UI styles, injected once per island via a <style> tag. Uses the site
 * theme CSS variables (see Base.astro) so the chat automatically follows
 * light/dark and any themechange with no JS. Shared by ChatModal and the /chat
 * page so both look identical.
 */
const CSS = `
.chat-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  font-size: 0.85rem;
  color: var(--muted);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
}
.chat-trigger:hover { background: var(--hover); }

.chat-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 10vh;
  background: var(--overlay);
}
.chat-modal {
  width: min(680px, 94vw);
  height: min(70vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.chat-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--border);
}
.chat-modal-title { font-weight: 600; font-size: 0.95rem; }
.chat-modal-actions { display: flex; gap: 0.4rem; align-items: center; }
.chat-newbtn, .chat-closebtn {
  font-family: inherit;
  font-size: 0.8rem;
  color: var(--muted);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.2rem 0.55rem;
  cursor: pointer;
}
.chat-newbtn:hover, .chat-closebtn:hover { background: var(--hover); color: var(--fg); }

.chat-conversation { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.chat-transcript {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.chat-empty, .chat-status {
  color: var(--muted);
  font-size: 0.85rem;
}
.chat-status { font-style: italic; }
.chat-msg { max-width: 100%; }
.chat-msg-user .chat-text {
  align-self: flex-end;
  background: var(--active);
  color: var(--active-fg);
  border-radius: 10px;
  padding: 0.5rem 0.75rem;
  white-space: pre-wrap;
  width: fit-content;
  margin-left: auto;
}
.chat-md {
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.25rem 0.85rem;
}
.chat-md p { margin: 0.6rem 0; }
.chat-md pre {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.7rem;
  overflow-x: auto;
}
.chat-md code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
}
.chat-md :not(pre) > code {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0.1em 0.35em;
}
.chat-sources {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
}
.chat-sources-label { color: var(--muted); }
.chat-source-link {
  color: var(--link);
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.1rem 0.55rem;
  text-decoration: none;
}
.chat-source-link:hover { background: var(--hover); }
.chat-error {
  color: var(--callout-caution);
  font-size: 0.85rem;
}
.chat-composer {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem;
  border-top: 1px solid var(--border);
}
.chat-input {
  flex: 1;
  resize: none;
  font-family: inherit;
  font-size: 0.95rem;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.55rem 0.7rem;
  max-height: 8rem;
  min-height: 2.5rem;
}
.chat-input:focus { outline: none; border-color: var(--link); }
.chat-send {
  font-family: inherit;
  color: #fff;
  background: var(--link);
  border: none;
  border-radius: 8px;
  padding: 0 1rem;
  cursor: pointer;
}
.chat-send:disabled { opacity: 0.5; cursor: default; }

/* /chat two-pane layout ------------------------------------------------- */
.chat-page {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 1rem;
  height: calc(100vh - 52px);
  padding: 1rem;
}
.chat-threadlist {
  border-right: 1px solid var(--border);
  padding-right: 1rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.chat-threadlist-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}
.chat-threaditem {
  text-align: left;
  font-family: inherit;
  font-size: 0.88rem;
  color: var(--fg);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0.45rem 0.6rem;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-threaditem:hover { background: var(--hover); }
.chat-threaditem.active {
  background: var(--active);
  color: var(--active-fg);
}
.chat-pane { min-width: 0; display: flex; flex-direction: column; }
@media (max-width: 720px) {
  .chat-page { grid-template-columns: 1fr; height: auto; }
  .chat-threadlist { border-right: none; border-bottom: 1px solid var(--border); }
  .chat-trigger, .chat-newbtn, .chat-closebtn, .chat-send { min-height: 40px; }
  .chat-newbtn, .chat-closebtn { padding: 0.4rem 0.7rem; }
}
`;

export function ChatStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
