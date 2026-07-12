# Memoria — live-SSR docs site

Turn a folder of markdown into a searchable, live, optionally AI-queryable docs
site — with **zero rebuild** between editing a doc and seeing it live.

## Why use this?

Most docs tooling (Docusaurus, VitePress, MkDocs…) compiles content at build
time. That creates two costs that make docs rot:

- **Edit latency.** Every typo fix means rebuild → redeploy → wait. When
  publishing a change takes minutes of CI, people stop making small fixes.
- **Coupling.** Content is baked into the artifact. Docs and deploys are welded
  together, so the team that writes docs depends on the team that ships code.

Memoria renders docs **at request time** and syncs them **from git at
runtime**:

- Edit a file, refresh the page — the change is live. Locally *and* in
  production (a push to your docs repo refreshes content via webhook, no
  deploy).
- The deployable image contains **no content**. One prebuilt image serves any
  team's docs — adopting it is configuration, not a codebase.
- Writers only ever touch markdown. Adding a page, a cross-link, a mermaid
  diagram, or even a live SQL table is a docs edit, not a code change.
- Search, nav tree, dark mode, and recents/favorites work out of the box with
  no external services. AI "ask the docs" chat and live-data embeds are
  opt-in via a single env var each, and hide themselves when unconfigured.

If your docs live next to your code and change often, this removes every step
between "I noticed a mistake" and "it's fixed for everyone."

## Get started

```bash
npm install
npm run dev
```

Open http://localhost:4321 — the site serves the `docs/` folder. Edit a file,
reload, see the change.

Point it at your own docs:

```bash
DOCS_DIR=/path/to/your/docs npm run dev
```

That's it. No config files, no keys — optional features stay off until you
enable them (see [Configuration](#configuration)).

**Add a page:** drop a `.md` file anywhere under the docs folder. It's live at
the URL matching its path (`guides/setup.md` → `/docs/guides/setup`).

## Authoring

| You write | You get |
| --- | --- |
| `.md` | Rendered markdown (GFM), raw HTML stripped |
| `.mdx` | Markdown with raw HTML passthrough (basis for live-data embeds) |
| `.html` | A fragment in the site layout, or a verbatim full page with `standalone: true` frontmatter |
| `# Heading` | The page title (first H1 wins) |
| Relative links (`../foo.md`) | Rewritten to in-site routes when the target exists; external/anchor/unknown links left as authored |
| ` ```mermaid ` fences | Client-rendered, theme-aware diagrams |
| `> [!NOTE]` / `[!WARNING]` | Styled callouts |
| Code fences | Syntax highlighting + copy button |
| `<div data-sql-table>` with inline SQL (in `.mdx`) | A live results table (when a query engine is configured) |

Readers get a nav tree, breadcrumbs, a ⌘K search palette (with a no-JS `?q=`
fallback), light/dark theme, and per-reader recents/favorites — no per-doc
setup.

## Configuration

Everything is env vars; every feature degrades cleanly when unset. Copy
`.env.example` and fill in only what you need.

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

The image contains no content — one build serves anyone's docs via env alone:

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
