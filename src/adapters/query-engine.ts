/**
 * Query-engine client (server-only).
 *
 * A generic port to an external, read-only query engine. The domain never
 * imports this — routes wire it up. All wire-format and transport concerns
 * live here.
 *
 * Wire shape (the assumed generic engine contract):
 *   Request:  POST {QUERY_ENGINE_URL}
 *             Content-Type: application/json
 *             Body: { "sql": "<single read-only statement>" }
 *   Response: 200 with JSON { "columns": string[], "rows": unknown[][] }
 *             where each row is an array positionally aligned to `columns`.
 *   Any non-2xx, or a body that is not shaped { columns, rows }, is an error.
 *
 * Design decisions encapsulated here:
 *  - QUERY_ENGINE_URL is read at CALL TIME (never module load) so tests/dev can
 *    repoint or unset it. It NEVER crosses into client code.
 *  - Unset/blank env → not configured. Callers branch on `isConfigured()` and
 *    degrade quietly rather than erroring.
 *  - SQL safety guards (single-statement, SELECT/WITH-only) are enforced HERE,
 *    server-side, before the query ever reaches the engine — the client is
 *    never trusted.
 *  - Time cap via AbortController; row cap by truncating results.
 */

/** Result of a successful query, already row-capped. */
export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  /** True when the engine returned more rows than QUERY_MAX_ROWS and we cut. */
  truncated: boolean;
}

function emptyToUndefined(v: string | undefined): string | undefined {
  return v && v.trim() !== "" ? v : undefined;
}

/** The configured engine URL, or undefined when the feature is off. */
function engineUrl(): string | undefined {
  return emptyToUndefined(process.env.QUERY_ENGINE_URL);
}

/** Feature toggle: false when QUERY_ENGINE_URL is unset/blank. */
export function isConfigured(): boolean {
  return engineUrl() !== undefined;
}

function maxRows(): number {
  const n = Number(process.env.QUERY_MAX_ROWS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

function timeoutMs(): number {
  const n = Number(process.env.QUERY_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
}

// ---------------------------------------------------------------------------
// SQL guards (server-side, mandatory)
// ---------------------------------------------------------------------------

/**
 * Strip leading whitespace and leading SQL comments (line `-- ...` and block
 * `/* ... *​/`) so the leading-keyword check sees the first real token. Only
 * leading comments are stripped; the string is otherwise untouched.
 */
function stripLeading(sql: string): string {
  let s = sql;
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, "");
    s = s.replace(/^--[^\n]*\n?/, "");
    s = s.replace(/^\/\*[\s\S]*?\*\//, "");
    if (s === before) return s;
  }
}

/**
 * Split into non-empty statements by top-level `;`. String/identifier literals
 * are not parsed — a semicolon inside a literal would over-count, which only
 * makes the guard STRICTER (rejects), never looser. Trailing `;` is allowed.
 */
function nonEmptyStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class SqlGuardError extends Error {}

/**
 * Enforce the read-only, single-statement contract. Throws SqlGuardError with a
 * caller-safe message on violation; returns the trimmed SQL on success.
 *
 *  - Non-empty.
 *  - Exactly one non-empty statement (one trailing `;` allowed).
 *  - First real keyword (after stripping leading whitespace/comments) is
 *    SELECT or WITH, case-insensitive.
 */
export function assertSafeSelect(sqlRaw: unknown): string {
  if (typeof sqlRaw !== "string" || sqlRaw.trim() === "") {
    throw new SqlGuardError("Query is empty.");
  }
  const sql = sqlRaw.trim();

  const statements = nonEmptyStatements(sql);
  if (statements.length === 0) {
    throw new SqlGuardError("Query is empty.");
  }
  if (statements.length > 1) {
    throw new SqlGuardError("Only a single statement is allowed.");
  }

  const leading = stripLeading(sql);
  if (!/^(select|with)\b/i.test(leading)) {
    throw new SqlGuardError("Only SELECT or WITH queries are allowed.");
  }

  return sql;
}

// ---------------------------------------------------------------------------
// Engine call
// ---------------------------------------------------------------------------

function isQueryWire(v: unknown): v is { columns: unknown; rows: unknown } {
  return typeof v === "object" && v !== null && "columns" in v && "rows" in v;
}

/**
 * Run a guarded read-only query against the configured engine.
 *
 * Preconditions: caller must have checked `isConfigured()`. The SQL is guarded
 * here regardless (defense in depth) via assertSafeSelect.
 *
 * Throws on: not configured, guard violation, timeout, transport error, non-2xx
 * response, or malformed wire body. Truncates rows to QUERY_MAX_ROWS.
 */
export async function runQuery(sqlRaw: string): Promise<QueryResult> {
  const url = engineUrl();
  if (!url) throw new Error("Query engine not configured.");

  const sql = assertSafeSelect(sqlRaw);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Query timed out after ${timeoutMs()}ms.`);
    }
    throw new Error(
      `Query engine request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Query engine returned ${res.status} ${res.statusText}.`);
  }

  const body: unknown = await res.json();
  if (!isQueryWire(body) || !Array.isArray(body.columns) || !Array.isArray(body.rows)) {
    throw new Error("Query engine returned an unexpected response shape.");
  }

  const columns = body.columns.map((c) => String(c));
  const allRows = body.rows as unknown[][];
  const cap = maxRows();
  const truncated = allRows.length > cap;
  const rows = truncated ? allRows.slice(0, cap) : allRows;

  return { columns, rows, truncated };
}
