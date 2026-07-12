import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertSafeSelect, runQuery, SqlGuardError } from "../src/adapters/query-engine";

describe("assertSafeSelect — accepts read-only single statements", () => {
  it("accepts a plain SELECT", () => {
    expect(assertSafeSelect("SELECT 1")).toBe("SELECT 1");
  });
  it("accepts WITH … SELECT", () => {
    const sql = "WITH t AS (SELECT 1 AS n) SELECT n FROM t";
    expect(assertSafeSelect(sql)).toBe(sql);
  });
  it("accepts a leading line comment", () => {
    expect(assertSafeSelect("-- comment\nSELECT 1")).toContain("SELECT 1");
  });
  it("accepts a leading block comment", () => {
    expect(assertSafeSelect("/* c */ SELECT 1")).toContain("SELECT 1");
  });
  it("accepts one trailing semicolon", () => {
    expect(assertSafeSelect("SELECT 1;")).toBe("SELECT 1;");
  });
  it("is case-insensitive on the leading keyword", () => {
    expect(assertSafeSelect("select 1")).toBe("select 1");
  });
});

describe("assertSafeSelect — rejects", () => {
  const bad: [string, string][] = [
    ["empty string", ""],
    ["whitespace only", "   \n  "],
    ["UPDATE", "UPDATE t SET x=1"],
    ["DELETE", "DELETE FROM t"],
    ["INSERT", "INSERT INTO t VALUES (1)"],
    ["DROP", "DROP TABLE t"],
    ["multi-statement", "SELECT 1; SELECT 2"],
    ["select then mutation", "SELECT 1; DROP TABLE t"],
  ];
  for (const [name, sql] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => assertSafeSelect(sql)).toThrow(SqlGuardError);
    });
  }
  it("rejects a non-string input", () => {
    expect(() => assertSafeSelect(42 as unknown)).toThrow(SqlGuardError);
  });
});

describe("runQuery — row cap", () => {
  const SAVE = ["QUERY_ENGINE_URL", "QUERY_MAX_ROWS"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of SAVE) saved[k] = process.env[k];
    process.env.QUERY_ENGINE_URL = "http://engine.local/query";
    process.env.QUERY_MAX_ROWS = "3";
  });
  afterEach(() => {
    for (const k of SAVE) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  it("truncates when the engine returns more than QUERY_MAX_ROWS rows", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => [i]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ columns: ["n"], rows }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await runQuery("SELECT n FROM t");
    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.columns).toEqual(["n"]);
  });

  it("does not truncate when rows are within the cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ columns: ["n"], rows: [[1], [2]] }), {
          status: 200,
        }),
      ),
    );
    const result = await runQuery("SELECT n FROM t");
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });
});
