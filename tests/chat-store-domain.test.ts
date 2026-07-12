import { describe, expect, it } from "vitest";
import {
  appendMessage,
  capMessages,
  capThreads,
  deriveTitle,
  MAX_MESSAGES_PER_THREAD,
  MAX_THREADS,
  newThread,
  orderByRecency,
  type StoredMessage,
  type Thread,
} from "../src/client/chat-store-domain";

describe("deriveTitle", () => {
  it("uses the first user message, trimmed and whitespace-collapsed", () => {
    const msgs: StoredMessage[] = [
      { role: "assistant", content: "ignored" },
      { role: "user", content: "  hello   there \n friend  " },
    ];
    expect(deriveTitle(msgs)).toBe("hello there friend");
  });

  it("truncates long titles to 60 chars with an ellipsis", () => {
    const long = "a".repeat(100);
    const title = deriveTitle([{ role: "user", content: long }]);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
  });

  it("falls back to a default when there is no user message", () => {
    expect(deriveTitle([{ role: "assistant", content: "hi" }])).toBe(
      "New conversation",
    );
    expect(deriveTitle([{ role: "user", content: "   " }])).toBe(
      "New conversation",
    );
  });
});

describe("orderByRecency", () => {
  it("orders most-recently-updated first without mutating input", () => {
    const threads: Thread[] = [
      { id: "a", title: "a", updatedAt: 1, messages: [] },
      { id: "b", title: "b", updatedAt: 3, messages: [] },
      { id: "c", title: "c", updatedAt: 2, messages: [] },
    ];
    const ordered = orderByRecency(threads);
    expect(ordered.map((t) => t.id)).toEqual(["b", "c", "a"]);
    // Input untouched.
    expect(threads.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("caps", () => {
  it("caps messages to the most recent MAX_MESSAGES_PER_THREAD", () => {
    const msgs: StoredMessage[] = Array.from(
      { length: MAX_MESSAGES_PER_THREAD + 5 },
      (_, i) => ({ role: "user", content: `m${i}` }),
    );
    const capped = capMessages(msgs);
    expect(capped).toHaveLength(MAX_MESSAGES_PER_THREAD);
    // Oldest dropped; newest kept.
    expect(capped[capped.length - 1].content).toBe(
      `m${MAX_MESSAGES_PER_THREAD + 4}`,
    );
    expect(capped[0].content).toBe("m5");
  });

  it("caps threads to the MAX_THREADS most recent", () => {
    const threads: Thread[] = Array.from(
      { length: MAX_THREADS + 10 },
      (_, i) => ({ id: `t${i}`, title: "x", updatedAt: i, messages: [] }),
    );
    const capped = capThreads(threads);
    expect(capped).toHaveLength(MAX_THREADS);
    // Highest updatedAt kept first.
    expect(capped[0].updatedAt).toBe(MAX_THREADS + 9);
  });
});

describe("appendMessage", () => {
  it("appends immutably, re-derives title, and bumps updatedAt", () => {
    const t = newThread("id1", 100);
    const next = appendMessage(t, { role: "user", content: "first question" }, 200);
    expect(next.messages).toHaveLength(1);
    expect(next.title).toBe("first question");
    expect(next.updatedAt).toBe(200);
    // Original untouched.
    expect(t.messages).toHaveLength(0);
    expect(t.title).toBe("New conversation");
  });
});
