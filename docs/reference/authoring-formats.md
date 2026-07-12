# Authoring formats

What each file type renders as.

| Format | Behavior |
| --- | --- |
| `.md` | Rendered markdown (GFM). Raw HTML is stripped. |
| `.mdx` | Markdown with raw HTML passthrough — required for [live-data embeds](../how-to/embed-live-data.mdx). |
| `.html` | Served as a fragment inside the site layout, or verbatim as a full page with `standalone: true` frontmatter (see [the standalone example](standalone-example.html)). |

When multiple files share a location, precedence is `.md` → `.mdx` → `.html`.

## Titles

- `.md` / `.mdx`: the first `# H1` is the title.
- `.html`: the `title:` frontmatter key.
- Neither present: the humanized filename.

## Markdown features

- GFM tables, task lists, strikethrough
- ` ```mermaid ` fences → client-rendered diagrams
- `> [!NOTE]`, `> [!WARNING]`, etc. → styled callouts
- Code fences → syntax highlighting with a copy button
- Relative links to real docs → rewritten to site routes
