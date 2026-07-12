/**
 * Pure conversation-domain logic for the chat store. NO browser APIs — no
 * indexedDB, no window. This is the unit-testable core: title derivation,
 * recency ordering, and size caps. The IndexedDB adapter (chat-store.ts) owns
 * all persistence and delegates every decision here.
 */

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Thread {
  id: string;
  title: string;
  /** ms since epoch; bumped on every append. */
  updatedAt: number;
  messages: StoredMessage[];
}

/** Keep at most this many threads (oldest dropped). */
export const MAX_THREADS = 50;
/** Keep at most this many messages per thread (oldest dropped). */
export const MAX_MESSAGES_PER_THREAD = 200;

const DEFAULT_TITLE = "New conversation";

/** Derive a thread title from its first user message (trimmed, one line). */
export function deriveTitle(messages: StoredMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = first?.content.trim().replace(/\s+/g, " ") ?? "";
  if (!text) return DEFAULT_TITLE;
  return text.length > 60 ? text.slice(0, 60).trimEnd() + "…" : text;
}

/** Order threads most-recently-updated first. Returns a new array. */
export function orderByRecency(threads: Thread[]): Thread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Cap a thread's message list to the most recent MAX_MESSAGES_PER_THREAD. */
export function capMessages(messages: StoredMessage[]): StoredMessage[] {
  return messages.length > MAX_MESSAGES_PER_THREAD
    ? messages.slice(messages.length - MAX_MESSAGES_PER_THREAD)
    : messages;
}

/** Cap the thread set to the MAX_THREADS most recent, dropping the oldest. */
export function capThreads(threads: Thread[]): Thread[] {
  const ordered = orderByRecency(threads);
  return ordered.slice(0, MAX_THREADS);
}

/** Create a fresh empty thread with the given id and clock. */
export function newThread(id: string, now: number): Thread {
  return { id, title: DEFAULT_TITLE, updatedAt: now, messages: [] };
}

/**
 * Append a message to a thread, returning a NEW thread with messages capped,
 * title re-derived, and updatedAt bumped. Pure — never mutates its input.
 */
export function appendMessage(
  thread: Thread,
  message: StoredMessage,
  now: number,
): Thread {
  const messages = capMessages([...thread.messages, message]);
  return {
    ...thread,
    messages,
    title: deriveTitle(messages),
    updatedAt: now,
  };
}
