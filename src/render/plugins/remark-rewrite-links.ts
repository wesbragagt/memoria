import type { Root } from "mdast";
import { visit } from "unist-util-visit";

export interface RewriteLinksOptions {
  /** Slug of the doc being rendered. Relative links resolve against its directory. */
  slug: string;
  /** Slugs known to exist in the site. Only links resolving into this set are rewritten. */
  knownSlugs: ReadonlySet<string>;
}

/** Links we never touch: they carry a scheme (http:, mailto:, tel:, etc.). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Only markdown docs are candidates for cross-doc rewriting. */
const IS_MARKDOWN = /\.mdx?$/i;

/**
 * Resolve a relative POSIX path against a base directory, collapsing
 * "." and "..". Returns null if the path escapes above the content root.
 */
function resolveSlug(baseDir: string, relative: string): string | null {
  const segments = baseDir === "" ? [] : baseDir.split("/");
  for (const part of relative.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null; // escapes the content tree
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join("/");
}

/**
 * Rewrite relative .md/.mdx links to `/docs/<slug>` routes, gated on
 * membership in `knownSlugs`. Everything else is left exactly as authored:
 * external/scheme links, absolute links, in-page anchors, links escaping the
 * content tree, and links whose resolved slug is unknown. Fragments are
 * preserved on rewrite.
 *
 * The slug model: a doc's slug is its content-relative path without the
 * .md/.mdx extension. `slug` is the current doc; its directory is the base
 * for resolving relative targets.
 */
export function remarkRewriteLinks(options: RewriteLinksOptions) {
  const { slug, knownSlugs } = options;
  const lastSlash = slug.lastIndexOf("/");
  const baseDir = lastSlash === -1 ? "" : slug.slice(0, lastSlash);

  return (tree: Root): void => {
    visit(tree, "link", (node) => {
      const url = node.url;
      if (!url) return;

      // In-page anchor only.
      if (url.startsWith("#")) return;
      // Scheme-bearing (http:, https:, mailto:, tel:, ...) and protocol-relative.
      if (HAS_SCHEME.test(url) || url.startsWith("//")) return;
      // Already absolute in-site path.
      if (url.startsWith("/")) return;

      // Split off an optional fragment; query strings are not expected for docs.
      const hashIndex = url.indexOf("#");
      const path = hashIndex === -1 ? url : url.slice(0, hashIndex);
      const fragment = hashIndex === -1 ? "" : url.slice(hashIndex);

      if (!IS_MARKDOWN.test(path)) return;

      const targetSlug = resolveSlug(baseDir, path.replace(IS_MARKDOWN, ""));
      if (targetSlug === null || !knownSlugs.has(targetSlug)) return;

      node.url = `/docs/${targetSlug}${fragment}`;
    });
  };
}
