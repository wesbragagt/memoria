# Configuration

All configuration is environment variables, read at call time. Every feature
degrades cleanly when its variable is unset.

| Env var | Default | Enables |
| --- | --- | --- |
| `DOCS_DIR` | `./docs` | Content directory to serve |
| `DOCS_GIT_REPO` | unset | Runtime git sync (unset → read `DOCS_DIR` directly) |
| `DOCS_GIT_REF` | `main` | Tracked ref for sync |
| `DOCS_GIT_SUBTREE` | `docs` | Sparse-checkout subtree within the docs repo |
| `REPO_DIR` | `/data/repo` | Writable checkout volume |
| `WEBHOOK_SECRET` | unset | HMAC verification for the update webhook |
| `GITHUB_APP_ID` / `GITHUB_APP_INSTALLATION_ID` / `GITHUB_APP_PRIVATE_KEY` | unset | Short-lived tokens for private docs repos |
| `OPENROUTER_API_KEY` | unset | "Ask the docs" AI chat (unset → trigger hidden) |
| `DOCS_AI_MODEL` | `anthropic/claude-3.5-haiku` | Chat model slug |
| `QUERY_ENGINE_URL` | unset | Live-data SQL embeds (unset → embeds report unavailable) |
| `HOST` / `PORT` | `0.0.0.0` / `4321` | Server bind |
| `SHUTDOWN_GRACE_MS` | `10000` | Drain window on SIGTERM |

See [Install the site](../how-to/install.md) for how these are used in
practice.
