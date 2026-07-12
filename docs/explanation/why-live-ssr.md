# Why live SSR?

Most documentation tooling compiles content at build time. That design has two
costs:

- **Edit latency.** Every change waits for a rebuild and redeploy before it is
  visible. When publishing a typo fix takes minutes of CI, people stop making
  small fixes, and docs rot.
- **Coupling.** Content is baked into the deployable artifact, so docs and
  deploys are welded together — the team that writes docs depends on the team
  that ships code.

Memoria inverts both decisions. Docs are read from disk and rendered **at
request time**, and in production the content directory is a **git checkout
synced at runtime** — a push to the docs repo refreshes content through a
verified webhook, with no deploy.

The consequences fall out naturally:

- Editing is live everywhere: the same render path runs in development and
  production.
- The deployable image is content-free, so one build serves any team's docs.
- Search never has a stale index, because there is no index — every query
  scans the current files.

The tradeoff is a single-instance content model and per-request rendering cost,
which is the right trade for internal docs measured in megabytes, not
terabytes.

Start with the [Getting Started tutorial](../tutorials/getting-started.md) to
feel the edit-reload loop firsthand.
