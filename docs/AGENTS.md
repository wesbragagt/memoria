# Conventions for this knowledge base

Rules for humans and agents adding or editing docs here.

## Structure

- Pages live in one of four folders by reader intent
  ([Diátaxis](https://diataxis.fr)):
  `tutorials/` (learning), `how-to/` (tasks), `reference/` (facts),
  `explanation/` (background).
- One concept per page. If a page covers two tasks, split it.
- [index.md](index.md) is the entry point — keep its map current when adding
  a page.

## Authoring

- The first `# H1` is the page title — the single source of truth.
- Frontmatter (`---` block) is for metadata only (`title:` for HTML files,
  `standalone:`, tags); it is never rendered.
- Link to other docs with relative paths ending in `.md`/`.mdx`
  (e.g. `../reference/configuration.md`) — they are rewritten to site routes
  when the target exists.
- Use `.md` by default; `.mdx` only when a page needs raw HTML (live-data
  embeds, custom markup).
- File names are kebab-case; the path is the URL, so choose names that can
  stay stable.
