// Command palette (⌘K / Ctrl+K). Vanilla, no framework. Live results from
// /api/search.json?q=; empty query shows Favorites then Recents from the
// localStorage store. Accessible dialog: focus trap on open, focus restore on
// close, roving selection with arrow keys.
import { getFavorites, getRecents } from "./store";

interface SearchResult {
  slug: string;
  title: string;
  snippet: string;
  matchedIn: string;
  url: string;
}

interface Item {
  title: string;
  url: string;
  meta: string;
}

const DEBOUNCE_MS = 140;

export function initPalette(): void {
  const found = document.querySelector<HTMLElement>("[data-palette]");
  if (!found) return;
  const overlay: HTMLElement = found;

  const input = overlay.querySelector<HTMLInputElement>("[data-palette-input]")!;
  const list = overlay.querySelector<HTMLElement>("[data-palette-list]")!;
  const status = overlay.querySelector<HTMLElement>("[data-palette-status]")!;
  const openers = document.querySelectorAll<HTMLElement>("[data-palette-open]");

  let items: Item[] = [];
  let selected = -1;
  let lastFocused: HTMLElement | null = null;
  let debounce = 0;
  let requestSeq = 0;

  const isOpen = () => !overlay.hidden;

  function open() {
    if (isOpen()) return;
    lastFocused = document.activeElement as HTMLElement | null;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    input.value = "";
    input.focus();
    renderDefault();
  }

  function close() {
    if (!isOpen()) return;
    overlay.hidden = true;
    document.body.style.overflow = "";
    window.clearTimeout(debounce);
    lastFocused?.focus();
  }

  function setStatus(text: string) {
    status.textContent = text;
  }

  function render(next: Item[], emptyHint: string) {
    items = next;
    selected = items.length > 0 ? 0 : -1;
    list.innerHTML = "";
    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "palette-empty";
      li.setAttribute("role", "presentation");
      li.textContent = emptyHint;
      list.appendChild(li);
      setStatus(emptyHint);
      return;
    }
    items.forEach((item, i) => {
      const li = document.createElement("li");
      li.id = `palette-item-${i}`;
      li.className = "palette-item";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === selected));
      li.innerHTML =
        `<span class="palette-title"></span>` +
        `<span class="palette-meta"></span>`;
      li.querySelector(".palette-title")!.textContent = item.title;
      li.querySelector(".palette-meta")!.textContent = item.meta;
      li.addEventListener("mousemove", () => setSelected(i));
      li.addEventListener("click", () => go(i));
      list.appendChild(li);
    });
    updateSelection();
    setStatus(`${items.length} result${items.length === 1 ? "" : "s"}`);
  }

  // Empty-query state: Favorites then Recents from localStorage.
  function renderDefault() {
    const favs = getFavorites().map<Item>((f) => ({
      title: f.title,
      url: `/docs/${f.slug}`,
      meta: "Favorite",
    }));
    const recents = getRecents().map<Item>((r) => ({
      title: r.title,
      url: `/docs/${r.slug}`,
      meta: "Recent",
    }));
    const combined = [...favs, ...recents];
    render(
      combined,
      "Type to search. Your favorites and recently viewed docs will appear here.",
    );
  }

  async function runSearch(q: string) {
    const seq = ++requestSeq;
    try {
      const res = await fetch(
        `/api/search.json?q=${encodeURIComponent(q)}`,
        { headers: { accept: "application/json" } },
      );
      if (seq !== requestSeq) return; // stale response
      const data: { results: SearchResult[] } = await res.json();
      const next = data.results.map<Item>((r) => ({
        title: r.title,
        url: r.url,
        meta: `in ${r.matchedIn}`,
      }));
      render(next, `No results for “${q}”.`);
    } catch {
      if (seq !== requestSeq) return;
      render([], "Search is unavailable right now.");
    }
  }

  function onInput() {
    window.clearTimeout(debounce);
    const q = input.value.trim();
    if (q === "") {
      renderDefault();
      return;
    }
    debounce = window.setTimeout(() => runSearch(q), DEBOUNCE_MS);
  }

  function setSelected(i: number) {
    if (i === selected) return;
    selected = i;
    updateSelection();
  }

  function updateSelection() {
    const nodes = list.querySelectorAll<HTMLElement>(".palette-item");
    nodes.forEach((node, i) => {
      const on = i === selected;
      node.setAttribute("aria-selected", String(on));
      node.classList.toggle("selected", on);
      if (on) {
        input.setAttribute("aria-activedescendant", node.id);
        node.scrollIntoView({ block: "nearest" });
      }
    });
    if (selected < 0) input.removeAttribute("aria-activedescendant");
  }

  function move(delta: number) {
    if (items.length === 0) return;
    selected = (selected + delta + items.length) % items.length;
    updateSelection();
  }

  function go(i: number) {
    const item = items[i];
    if (item) window.location.href = item.url;
  }

  // Global open shortcut + slash-to-focus is intentionally omitted; ⌘K/Ctrl+K.
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      isOpen() ? close() : open();
    }
  });

  openers.forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      open();
    }),
  );

  // Backdrop click closes; clicks inside the dialog do not.
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  input.addEventListener("input", onInput);

  overlay.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Enter":
        if (selected >= 0) {
          e.preventDefault();
          go(selected);
        }
        break;
      case "Tab": {
        // Focus trap: only the input and dialog are focusable, so keep focus
        // on the input.
        e.preventDefault();
        input.focus();
        break;
      }
    }
  });
}
