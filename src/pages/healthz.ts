import type { APIRoute } from "astro";

// Liveness/readiness probe for Kubernetes. Must be cheap and side-effect free:
// the middleware short-circuits before ensureCloned() so a probe never triggers
// a git sync.
export const prerender = false;

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
