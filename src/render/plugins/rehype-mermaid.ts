import type { Element, Root, Text } from "hast";
import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";

/**
 * Convert ```mermaid fenced code blocks into `<pre class="mermaid">…</pre>`
 * carrying the raw diagram source as text, for client-side theme-aware
 * rendering. Must run BEFORE rehype-highlight so the source is emitted
 * verbatim rather than tokenized.
 *
 * remark-rehype renders a fenced block as `<pre><code class="language-x">`.
 * We detect the `language-mermaid` code child and rewrite the wrapping `pre`.
 */
export function rehypeMermaid() {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "pre") return;
      const code = node.children.find(
        (child): child is Element =>
          child.type === "element" && child.tagName === "code",
      );
      if (!code) return;

      const classes = code.properties?.className;
      const isMermaid =
        Array.isArray(classes) && classes.includes("language-mermaid");
      if (!isMermaid) return;

      const source = toString(code);
      node.properties = { className: ["mermaid"] };
      const text: Text = { type: "text", value: source };
      node.children = [text];
    });
  };
}
