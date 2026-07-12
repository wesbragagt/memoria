# Memoria — live-SSR docs site

Turn any folder of docs into a searchable, live, optionally AI-queryable site —
with **zero rebuild** between a docs edit and it going live.

Docs are rendered at request time and synced from a git repo at runtime, so the
deployable artifact carries no content: fix a typo, push, and the next page view
shows it. No redeploy, ever.

## Quick start (local)

```bash
npm install
npm run dev
```

Open http://localhost:4321. The site serves whatever is in `docs/` — edit a
file and reload; the change is live immediately.

To point it at your own content:

```bash
DOCS_DIR=/path/to/your/docs npm run dev
```

That's the whole local setup. No git sync, no keys, no config needed — optional
features stay quietly off until configured.

## Authoring

Drop files into the content directory; each becomes a page at a URL matching
its path (`guides/setup.md` → `/docs/guides/setup`). No code change, no rebuild.

| You write | You get |
| --- | --- |
| `.md` | Rendered markdown (GFM), raw HTML stripped |
| `.mdx` | Markdown with raw HTML passthrough (basis for live-data embeds) |
| `.html` | Served as a fragment in the site layout, or verbatim as a full page with `standalone: true` frontmatter |
| `# Heading` | Page title (md/mdx) — first H1 wins |
| Relative links (`../foo.md`) | Rewritten to in-site routes when the target doc exists; external/anchor/unknown links left as authored |
| ` ```mermaid ` fences | Client-rendered, theme-aware diagrams |
| `> [!NOTE]` / `[!WARNING]` | Styled callouts |
| Code fences | Syntax highlighting + copy button |
| `<div data-sql-table>` with inline SQL (in `.mdx`) | A live results table (when a query engine is configured) |

Readers get a nav tree, breadcrumbs, ⌘K search palette (with a no-JS `?q=`
fallback on the home page), light/dark theme, and per-reader recents/favorites —
all with no per-doc setup.

## Configuration

Everything is env vars, read at call time. Copy `.env.example` and fill in what
you need — every feature degrades cleanly when unset.

| Env var | Default | Enables |
| --- | --- | --- |
| `DOCS_DIR` | `./docs` | Content directory to serve |
| `DOCS_GIT_REPO` | unset | Runtime git sync (unset → read `DOCS_DIR` directly) |
| `DOCS_GIT_REF` | `main` | Tracked ref for sync |
| `DOCS_GIT_SUBTREE` | `docs` | Sparse-checkout subtree within the docs repo |
| `REPO_DIR` | `/data/repo` | Writable checkout volume |
| `WEBHOOK_SECRET` | unset | HMAC verification for `POST /api/github-webhook` |
| `GITHUB_APP_ID` / `GITHUB_APP_INSTALLATION_ID` / `GITHUB_APP_PRIVATE_KEY` | unset | Short-lived tokens for private docs repos |
| `OPENROUTER_API_KEY` | unset | "Ask the docs" AI chat (unset → trigger hidden) |
| `DOCS_AI_MODEL` | `anthropic/claude-3.5-haiku` | Chat model slug |
| `QUERY_ENGINE_URL` | unset | Live-data SQL embeds (unset → embeds report unavailable) |
| `HOST` / `PORT` | `0.0.0.0` / `4321` | Server bind |
| `SHUTDOWN_GRACE_MS` | `10000` | Drain window on SIGTERM |

## Production

The image contains **no content** — one build serves anyone's docs via env
config alone:

```bash
npm run docker:build
docker run -p 4321:4321 \
  -e DOCS_GIT_REPO=https://github.com/your-org/your-docs \
  -e WEBHOOK_SECRET=change-me \
  -v docs-data:/data \
  memoria
```

On boot it shallow-clones your docs repo; a push to the tracked ref hits the
HMAC-verified webhook and refreshes content in place. Kubernetes manifests
(SSO-gated ingress with a public webhook path, probes, single-replica
rationale) and an idempotent webhook-registration script live in
[`deploy/`](deploy/README.md).

## Development

```bash
npm run verify   # type-check && lint && test && build
npm test         # vitest — pins the invariants below
```

The architecture is ports-and-adapters; each layer has a README stating its
rules: [`src/domain/`](src/domain/README.md) (pure doc resolution/search),
[`src/render/`](src/render/README.md) (request-time unified pipeline),
[`src/adapters/`](src/adapters/README.md) (git sync, AI, query engine — all
server-only, all optional), [`src/client/`](src/client/README.md) (no secrets),
`src/pages/` (thin entrypoints).

Invariants the test suite pins — don't weaken them to pass:

1. Doc reads are never cached (live editing depends on it).
2. One render code path for dev and prod.
3. Content is never baked into the image.
4. Secrets are server-side only.
5. Link rewriting only touches links to real docs.
6. Optional features degrade, never error — and a failed content sync never
   wipes the currently served content.
