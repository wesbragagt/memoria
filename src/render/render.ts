import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { rehypeExtractToc, type TocEntry } from "./plugins/rehype-extract-toc";
import { rehypeMermaid } from "./plugins/rehype-mermaid";
import { remarkRewriteLinks } from "./plugins/remark-rewrite-links";

export type { TocEntry } from "./plugins/rehype-extract-toc";

export interface RenderOptions {
  /** Content-relative slug of the doc being rendered (path without extension). */
  slug: string;
  /**
   * Whether raw embedded HTML is preserved. `.mdx` → true (islands basis),
   * `.md` → false (raw HTML is stripped, not injected).
   */
  allowHtml: boolean;
  /** Slugs known to exist; gates cross-doc link rewriting. */
  knownSlugs: ReadonlySet<string>;
}

export interface RenderResult {
  html: string;
  toc: TocEntry[];
}

/**
 * Render markdown to HTML at request time. Callers strip frontmatter first;
 * this pipeline has no frontmatter handling.
 *
 * Raw HTML handling: remark-rehype is told to pass raw HTML through as `raw`
 * nodes only when `allowHtml` is set (allowDangerousHtml), and rehype-raw then
 * reparses those raw nodes into real hast. When `allowHtml` is false,
 * allowDangerousHtml is off so embedded HTML is dropped by remark-rehype and
 * rehype-raw is skipped entirely — raw HTML can never be injected from .md.
 *
 * Ordering notes:
 * - rehype-mermaid runs before rehype-highlight so mermaid source is emitted
 *   verbatim as <pre class="mermaid"> rather than tokenized.
 * - rehype-slug runs before TOC extraction and autolink so ids exist and the
 *   collected heading text is free of injected anchor markup.
 * - Code blocks keep rehype-highlight's default output: <pre><code
 *   class="hljs language-<lang>">…</code></pre>, giving a later client script
 *   the language class needed for a label + copy button.
 */
export async function renderMarkdown(
  markdown: string,
  options: RenderOptions,
): Promise<RenderResult> {
  const { slug, allowHtml, knownSlugs } = options;
  const toc: TocEntry[] = [];

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRewriteLinks, { slug, knownSlugs })
    .use(remarkRehype, { allowDangerousHtml: allowHtml });

  if (allowHtml) {
    processor.use(rehypeRaw);
  }

  processor
    .use(rehypeSlug)
    .use(rehypeExtractToc, toc)
    .use(rehypeAutolinkHeadings)
    .use(rehypeMermaid)
    .use(rehypeHighlight, { detect: true })
    .use(rehypeStringify, { allowDangerousHtml: allowHtml });

  const file = await processor.process(markdown);
  return { html: String(file), toc };
}
