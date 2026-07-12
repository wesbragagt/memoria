/**
 * Guarded live-data query endpoint.
 *
 * Accepts a single read-only SQL statement and runs it against the server-side
 * query-engine adapter. ALL safety guards are enforced server-side here/in the
 * adapter — the client is never trusted. Accepts both:
 *   - POST with JSON body { sql }
 *   - GET with ?sql=... (convenience; same guards apply)
 *
 * Responses follow the shared envelope (see json-route.ts):
 *   - engine unconfigured → 200 {configured:false}
 *   - success            → 200 {configured:true, columns, rows, truncated}
 *   - failure/guard       → 502 {configured:true, error}
 *
 * Successful results are cached briefly, keyed by the exact SQL text, so a doc
 * with repeated identical embeds or rapid reloads doesn't hammer the engine.
 */
import type { APIRoute } from "astro";
import { cachedJsonRoute, NotConfiguredError } from "../../adapters/json-route";
import { isConfigured, runQuery } from "../../adapters/query-engine";

// Short TTL: live-ish data without stampeding the engine. Keyed by SQL text.
const QUERY_TTL_MS = 15_000;

async function handle(sql: string | null): Promise<Response> {
  const key = (sql ?? "").trim();
  return cachedJsonRoute({
    key,
    ttlMs: QUERY_TTL_MS,
    load: async () => {
      // Off-state must map to {configured:false}, so signal it explicitly and
      // never cache it. runQuery would also throw a plain Error here, which the
      // envelope would mis-map to a 502 — hence the explicit check.
      if (!isConfigured()) throw new NotConfiguredError();
      return await runQuery(key);
    },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let sql: string | null = null;
  try {
    const body = (await request.json()) as { sql?: unknown };
    sql = typeof body.sql === "string" ? body.sql : null;
  } catch {
    sql = null;
  }
  return handle(sql);
};

export const GET: APIRoute = async ({ url }) => {
  return handle(url.searchParams.get("sql"));
};
