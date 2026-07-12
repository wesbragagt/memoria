// Enhance highlighted code blocks: add a language label + copy button.
// The render pipeline emits <pre><code class="hljs language-<lang>">…</code>.
// Mermaid blocks are <pre class="mermaid"> (no code.hljs) so they're skipped.

function langFromClass(code: Element): string | null {
  for (const cls of Array.from(code.classList)) {
    if (cls.startsWith("language-")) {
      const lang = cls.slice("language-".length);
      if (lang && lang !== "undefined") return lang;
    }
  }
  return null;
}

export function enhanceCodeBlocks(root: ParentNode = document): void {
  const blocks = root.querySelectorAll<HTMLElement>("pre > code.hljs");
  blocks.forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.dataset.enhanced === "true") return;
    pre.dataset.enhanced = "true";
    pre.classList.add("code-block");

    const bar = document.createElement("div");
    bar.className = "code-bar";

    const lang = langFromClass(code);
    if (lang) {
      const label = document.createElement("span");
      label.className = "code-lang";
      label.textContent = lang;
      bar.appendChild(label);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code to clipboard");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.innerText);
        button.textContent = "Copied";
        button.classList.add("copied");
      } catch {
        button.textContent = "Failed";
      }
      window.setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("copied");
      }, 1500);
    });
    bar.appendChild(button);

    pre.insertBefore(bar, pre.firstChild);
  });
}
