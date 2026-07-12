// Lazy boot-time content sync.
//
// Astro's node standalone adapter has no first-class "on boot" hook, so we use
// a middleware to fire the memoized ensureCloned() on the first request. It is
// memoized in the adapter, so this runs the clone at most once per process
// (a failed clone clears the memo and retries on the next request).
//
// We AWAIT the first sync so a fresh pod serves real content on its very first
// response rather than an empty/missing docs dir. Subsequent requests await an
// already-resolved promise (near-zero cost). When DOCS_GIT_REPO is unset,
// ensureCloned() resolves immediately — no git, no blocking.
import { defineMiddleware } from "astro:middleware";
import { ensureCloned } from "./adapters/git-repo";

export const onRequest = defineMiddleware(async (context, next) => {
  // Health probes must never trigger a git sync or any heavy work.
  if (context.url.pathname === "/healthz") {
    return next();
  }
  try {
    await ensureCloned();
  } catch {
    // A failed initial sync must not take down request serving; the adapter
    // clears its memo so the next request retries. If content is genuinely
    // absent, the domain degrades to an empty docs list on its own.
  }
  return next();
});
