/**
 * IndexedDB persistence adapter for chat threads. THE ONLY file that touches
 * indexedDB. No server state — every reader's history lives in their browser.
 * All domain decisions (titles, recency, caps) are delegated to the pure
 * chat-store-domain module.
 *
 * DB "docs-chat", object store "threads" keyed by thread id.
 */
import {
  appendMessage,
  capThreads,
  newThread,
  orderByRecency,
  type StoredMessage,
  type Thread,
} from "./chat-store-domain";

export type { StoredMessage, Thread } from "./chat-store-domain";

const DB_NAME = "docs-chat";
const DB_VERSION = 1;
const STORE = "threads";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** All threads, most-recently-updated first. */
export async function listThreads(): Promise<Thread[]> {
  const db = await openDb();
  const all = await reqDone(tx(db, "readonly").getAll() as IDBRequest<Thread[]>);
  return orderByRecency(all);
}

/** The most recently updated thread, or null when history is empty. */
export async function latestThread(): Promise<Thread | null> {
  const threads = await listThreads();
  return threads[0] ?? null;
}

export async function getThread(id: string): Promise<Thread | null> {
  const db = await openDb();
  const t = await reqDone(tx(db, "readonly").get(id) as IDBRequest<Thread | undefined>);
  return t ?? null;
}

async function putThread(thread: Thread): Promise<void> {
  const db = await openDb();
  await reqDone(tx(db, "readwrite").put(thread));
}

export async function deleteThread(id: string): Promise<void> {
  const db = await openDb();
  await reqDone(tx(db, "readwrite").delete(id));
}

function makeId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `t_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
}

/** Create, persist, and return a fresh empty thread. */
export async function createThread(): Promise<Thread> {
  const thread = newThread(makeId(), Date.now());
  await putThread(thread);
  await enforceThreadCap();
  return thread;
}

/**
 * Append a message to a thread and persist it. Returns the updated thread.
 * Title/caps/recency are handled by the domain layer.
 */
export async function appendToThread(
  id: string,
  message: StoredMessage,
): Promise<Thread> {
  const existing = (await getThread(id)) ?? newThread(id, Date.now());
  const updated = appendMessage(existing, message, Date.now());
  await putThread(updated);
  return updated;
}

/** Drop the oldest threads beyond MAX_THREADS. */
async function enforceThreadCap(): Promise<void> {
  const all = await listThreads();
  const kept = capThreads(all);
  if (kept.length === all.length) return;
  const keepIds = new Set(kept.map((t) => t.id));
  await Promise.all(
    all.filter((t) => !keepIds.has(t.id)).map((t) => deleteThread(t.id)),
  );
}
