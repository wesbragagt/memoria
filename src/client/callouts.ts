// Upgrade GitHub-style callouts. The render pipeline leaves blockquotes whose
// first text starts with [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] /
// [!CAUTION] as plain blockquotes; here we detect the marker, strip it, and
// render an icon + textual label (label conveys type — not color alone, for a11y).

type CalloutKind =
  | "NOTE"
  | "TIP"
  | "IMPORTANT"
  | "WARNING"
  | "CAUTION";

// Inline SVGs keyed by kind (no external icon fetch). 16px, currentColor.
const ICONS: Record<CalloutKind, string> = {
  NOTE: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM7 7.25a.75.75 0 0 1 .75-.75h.5A.75.75 0 0 1 9 7.25v3.25h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5H7.5V8h-.25A.75.75 0 0 1 7 7.25Z"/></svg>',
  TIP: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 1.5A4.5 4.5 0 0 0 5 9.35c.4.36.62.77.7 1.15h4.6c.08-.38.3-.79.7-1.15A4.5 4.5 0 0 0 8 1.5ZM6.25 12a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z"/></svg>',
  IMPORTANT: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2.5 2A1.5 1.5 0 0 0 1 3.5v7A1.5 1.5 0 0 0 2.5 12H5l2.4 2.55a.85.85 0 0 0 1.2 0L11 12h2.5A1.5 1.5 0 0 0 15 10.5v-7A1.5 1.5 0 0 0 13.5 2h-11ZM7.25 4.5a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0v-3ZM8 9.25a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z"/></svg>',
  WARNING: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.7 1.75a1.5 1.5 0 0 1 2.6 0l5.5 9.5A1.5 1.5 0 0 1 13.5 13.5h-11a1.5 1.5 0 0 1-1.3-2.25l5.5-9.5ZM7.25 5.5a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0v-3ZM8 10.25a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z"/></svg>',
  CAUTION: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4.47 1.5a1.5 1.5 0 0 0-1.06.44L1.94 3.41A1.5 1.5 0 0 0 1.5 4.47v7.06c0 .4.16.78.44 1.06l1.47 1.47c.28.28.66.44 1.06.44h7.06c.4 0 .78-.16 1.06-.44l1.47-1.47c.28-.28.44-.66.44-1.06V4.47c0-.4-.16-.78-.44-1.06l-1.47-1.47a1.5 1.5 0 0 0-1.06-.44H4.47ZM7.25 4.5a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0v-3ZM8 9.25a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z"/></svg>',
};

const LABELS: Record<CalloutKind, string> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

const MARKER = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

export function enhanceCallouts(root: ParentNode = document): void {
  const quotes = root.querySelectorAll<HTMLQuoteElement>("blockquote");
  quotes.forEach((quote) => {
    if (quote.dataset.callout) return;

    const first = quote.querySelector("p");
    if (!first) return;
    const match = first.textContent?.match(MARKER);
    if (!match) return;

    const kind = match[1] as CalloutKind;
    quote.dataset.callout = kind.toLowerCase();

    // Strip the marker from the leading paragraph's text node(s).
    stripMarker(first);
    // If the first paragraph is now empty, drop it.
    if (!first.textContent?.trim() && first.childElementCount === 0) {
      first.remove();
    }

    const header = document.createElement("div");
    header.className = "callout-header";
    header.innerHTML =
      ICONS[kind] + `<span class="callout-label">${LABELS[kind]}</span>`;
    quote.insertBefore(header, quote.firstChild);
  });
}

// Remove the [!KIND] marker from the start of an element's text, touching only
// the first text node so inline markup after it is preserved.
function stripMarker(el: Element): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (node && node.textContent) {
    node.textContent = node.textContent.replace(MARKER, "");
  }
}
