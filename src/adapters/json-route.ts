/**
 * Shared JSON envelope + degradation policy for live-data API routes.
 *
 * Every live endpoint funnels through cachedJsonRoute so the wire envelope and
 * the "degrade, don't error" policy live in ONE place:
 *
 *   - Engine not configured (load throws NotConfigured) → 200 {configured:false}
 *     (never cached — config can change between deploys/restarts).
 *   - Fresh cache hit → the previously-cached success body.
 *   - Otherwise run load(), wrap as {configured:true, ...result}, cache for
 *     ttlMs, and return it.
 *   - load() throws anything else → 502 {configured:true, error:<message>}
 *     (never cached — errors must be retried, not memoized).
 *
 * The cache here is for API RESPONSES only (short TTL). It does NOT cache doc
 * content, so it does not touch the no-doc-caching invariant. It is in-module,
 * keyed, and expiry-checked.
 */

/**
 * Signal from a load() function that the underlying feature is not configured.
 * cachedJsonRoute maps this to a 200 {configured:false} — never a 502.
 */
export class NotConfiguredError extends Error {
  constructor(message = "not configured") {
    super(message);
    this.name = "NotConfiguredError";
  }
}

interface CacheEntry {
  body: string;
  expiresAt: number;
}

// Keyed in-module cache. Success bodies only; entries expire by wall clock.
const cache = new Map<string, CacheEntry>();

export interface CachedJsonRouteOptions<T> {
  /** Cache key for this response (e.g. the SQL text). Success bodies keyed by it. */
  key: string;
  /** How long a successful response stays fresh, in ms. */
  ttlMs: number;
  /**
   * Produce the result payload. Throw NotConfiguredError to signal the off
   * state; throw anything else to signal a real failure.
   */
  load: () => Promise<T>;
}

const JSON_HEADERS_UNCACHED = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

/**
 * Run one live-data route with the shared envelope, cache, and degrade policy.
 * Always resolves to a Response (never rejects).
 */
export async function cachedJsonRoute<T>(
  opts: CachedJsonRouteOptions<T>,
): Promise<Response> {
  const now = Date.now();

  const hit = cache.get(opts.key);
  if (hit && hit.expiresAt > now) {
    return new Response(hit.body, { status: 200, headers: JSON_HEADERS_UNCACHED });
  }
  if (hit) cache.delete(opts.key); // expired

  let result: T;
  try {
    result = await opts.load();
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return new Response(JSON.stringify({ configured: false }), {
        status: 200,
        headers: JSON_HEADERS_UNCACHED,
      });
    }
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ configured: true, error: message }), {
      status: 502,
      headers: JSON_HEADERS_UNCACHED,
    });
  }

  const body = JSON.stringify({ configured: true, ...result });
  cache.set(opts.key, { body, expiresAt: now + opts.ttlMs });
  return new Response(body, { status: 200, headers: JSON_HEADERS_UNCACHED });
}
