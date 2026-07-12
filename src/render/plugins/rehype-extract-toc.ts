import type { Element, Root } from "hast";
import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";

export interface TocEntry {
  depth: number;
  id: string;
  text: string;
}

/**
 * Collect h2/h3 headings (with ids produced by rehype-slug) into `collector`
 * for an "On this page" list. Must run AFTER rehype-slug so ids exist, and
 * before rehype-autolink-headings mutates heading children — running before
 * autolink keeps `toString` clean of the injected anchor link text.
 */
export function rehypeExtractToc(collector: TocEntry[]) {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element) => {
      const depth =
        node.tagName === "h2" ? 2 : node.tagName === "h3" ? 3 : 0;
      if (depth === 0) return;

      const id = node.properties?.id;
      if (typeof id !== "string" || id === "") return;

      collector.push({ depth, id, text: toString(node).trim() });
    });
  };
}
