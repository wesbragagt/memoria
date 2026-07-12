// Client-side mermaid rendering, theme-aware, loaded on demand.
//
// The render pipeline emits <pre class="mermaid">SOURCE</pre>. We only import
// mermaid — pinned ESM CDN build, kept out of the bundle — when at least one
// such block exists on the page. If the import fails (e.g. offline), we leave
// the source text visible: degrade, don't error.
//
// PIN: mermaid@11.4.1 from esm.sh. Bump deliberately; a floating range would
// let diagrams change under us.
const MERMAID_URL = "https://esm.sh/mermaid@11.4.1";

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, src: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi | null> | null = null;

function loadMermaid(): Promise<MermaidApi | null> {
  if (!mermaidPromise) {
    mermaidPromise = import(/* @vite-ignore */ MERMAID_URL)
      .then((m) => (m.default ?? m) as MermaidApi)
      .catch(() => null);
  }
  return mermaidPromise;
}

function themeName(): "dark" | "default" {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "default";
}

let counter = 0;

async function renderAll(mermaid: MermaidApi): Promise<void> {
  mermaid.initialize({ startOnLoad: false, theme: themeName() });

  const blocks = document.querySelectorAll<HTMLElement>("pre.mermaid");
  for (const block of Array.from(blocks)) {
    // Keep the original source so we can re-render on theme change.
    const source = block.dataset.mermaidSrc ?? block.textContent ?? "";
    block.dataset.mermaidSrc = source;
    try {
      const { svg } = await mermaid.render(`mermaid-${counter++}`, source);
      block.innerHTML = svg;
      block.dataset.rendered = "true";
    } catch {
      // Leave the (already visible) source text in place on parse errors.
      block.textContent = source;
      delete block.dataset.rendered;
    }
  }
}

export async function initMermaid(): Promise<void> {
  if (!document.querySelector("pre.mermaid")) return;

  const mermaid = await loadMermaid();
  if (!mermaid) return; // offline / blocked: source stays visible.

  await renderAll(mermaid);

  // Re-theme on toggle. themechange is dispatched by the theme module.
  window.addEventListener("themechange", () => {
    void renderAll(mermaid);
  });
}
