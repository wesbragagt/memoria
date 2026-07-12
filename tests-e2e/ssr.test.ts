// SSR e2e: markdown pages rendered at request time by the BUILT prod server.
//
// Server env: DOCS_DIR points at a mkdtemp fixture; no git/webhook config, so
// the sync middleware is a no-op. Every assertion is made over real HTTP
// against the production build — this is the true end-to-end contract.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer, type ServerHandle } from "./harness";

const PORT_OFFSET = 0;

let docsDir: string;
let server: ServerHandle;

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(docsDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

beforeAll(async () => {
  docsDir = await mkdtemp(path.join(tmpdir(), "memoria-e2e-ssr-"));

  // Rich markdown: h1 title, GFM table, fenced code block, a relative cross-doc
  // link and an external link, plus frontmatter that must not leak.
  await write(
    "guide.md",
    [
      "---",
      "title: Ignored Frontmatter Title",
      "secretkey: do-not-leak-abc123",
      "---",
      "",
      "# Guide Heading",
      "",
      "Intro paragraph mentioning zebra keyword.",
      "",
      "| Col A | Col B |",
      "| ----- | ----- |",
      "| one   | two   |",
      "",
      "```js",
      "const answer = 42;",
      "```",
      "",
      "See the [installation notes](./nested/install.md) for setup.",
      "",
      "Visit [external site](https://example.com/page) for more.",
      "",
    ].join("\n"),
  );

  await write(
    "nested/install.md",
    ["# Install", "", "How to install.", ""].join("\n"),
  );

  await write(
    "standalone-page.html",
    [
      "---",
      "standalone: true",
      "title: Standalone",
      "---",
      "<!doctype html><html><head><title>Raw Standalone</title></head>" +
        "<body><h1>Standalone Verbatim</h1></body></html>",
    ].join("\n"),
  );

  server = await startServer(PORT_OFFSET, { DOCS_DIR: docsDir });
});

afterAll(async () => {
  await server?.stop();
  if (docsDir) await rm(docsDir, { recursive: true, force: true });
});

async function getText(pathname: string): Promise<{ status: number; ct: string; body: string }> {
  const res = await fetch(`${server.baseUrl}${pathname}`);
  return {
    status: res.status,
    ct: res.headers.get("content-type") ?? "",
    body: await res.text(),
  };
}

describe("SSR of markdown pages", () => {
  it("renders h1, GFM table + code block, and heading ids (200 html)", async () => {
    const { status, ct, body } = await getText("/docs/guide");
    expect(status).toBe(200);
    expect(ct).toContain("text/html");
    // H1 rendered with a slug id (rehype-slug).
    expect(body).toMatch(/<h1[^>]*id="guide-heading"[^>]*>/);
    expect(body).toContain("Guide Heading");
    // GFM table.
    expect(body).toContain("<table>");
    expect(body).toContain("<td>one</td>");
    // Fenced code block (rehype-highlight adds hljs + language class).
    expect(body).toMatch(/<code class="[^"]*language-js/);
    expect(body).toContain("answer");
  });

  it("reflects a live edit to the fixture on the next request (THE invariant)", async () => {
    const before = await getText("/docs/guide");
    expect(before.body).toContain("zebra keyword");
    expect(before.body).not.toContain("mongoose keyword");

    await write(
      "guide.md",
      ["# Guide Heading", "", "Intro paragraph mentioning mongoose keyword.", ""].join("\n"),
    );

    const after = await getText("/docs/guide");
    expect(after.status).toBe(200);
    expect(after.body).toContain("mongoose keyword");
    expect(after.body).not.toContain("zebra keyword");

    // Restore the rich fixture for independence from later assertions.
    await write(
      "guide.md",
      [
        "---",
        "title: Ignored Frontmatter Title",
        "secretkey: do-not-leak-abc123",
        "---",
        "",
        "# Guide Heading",
        "",
        "Intro paragraph mentioning zebra keyword.",
        "",
        "See the [installation notes](./nested/install.md) for setup.",
        "",
        "Visit [external site](https://example.com/page) for more.",
        "",
      ].join("\n"),
    );
  });

  it("rewrites a relative cross-doc link and leaves external links untouched", async () => {
    const { body } = await getText("/docs/guide");
    // ./nested/install.md resolves to slug "nested/install" → /docs/nested/install
    expect(body).toContain('href="/docs/nested/install"');
    // External link preserved verbatim.
    expect(body).toContain('href="https://example.com/page"');
  });

  it("does not leak frontmatter into the rendered page", async () => {
    const { body } = await getText("/docs/guide");
    expect(body).not.toContain("do-not-leak-abc123");
    expect(body).not.toContain("Ignored Frontmatter Title");
    expect(body).not.toContain("secretkey");
  });

  it("returns 404 for unknown slugs and for path traversal (plain + encoded)", async () => {
    const missing = await getText("/docs/does-not-exist");
    expect(missing.status).toBe(404);

    const traversal = await getText("/docs/../package.json");
    expect(traversal.status).toBe(404);
    expect(traversal.body).not.toContain('"name": "memoria"');

    const encoded = await getText("/docs/..%2F..%2Fpackage.json");
    expect(encoded.status).toBe(404);
    expect(encoded.body).not.toContain('"name": "memoria"');
  });

  it("serves standalone HTML verbatim (no chrome) and adds chrome to markdown", async () => {
    const standalone = await getText("/docs/standalone-page");
    expect(standalone.status).toBe(200);
    expect(standalone.ct).toContain("text/html");
    expect(standalone.body).toContain("Standalone Verbatim");
    // No site chrome from the Base layout.
    expect(standalone.body).not.toContain('class="site-header"');
    expect(standalone.body).not.toContain('class="brand"');

    const withChrome = await getText("/docs/guide");
    expect(withChrome.body).toContain('class="site-header"');
    expect(withChrome.body).toContain(">memoria</a>");
  });

  it("search endpoint reflects current fixture content", async () => {
    const res = await fetch(`${server.baseUrl}/api/search.json?q=zebra`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      results: { slug: string; url: string }[];
    };
    expect(json.results.some((r) => r.slug === "guide")).toBe(true);
    expect(json.results.find((r) => r.slug === "guide")?.url).toBe("/docs/guide");

    // A term present in no fixture yields no hits.
    const none = await fetch(`${server.baseUrl}/api/search.json?q=quokkaquokka`);
    const noneJson = (await none.json()) as { results: unknown[] };
    expect(noneJson.results).toHaveLength(0);
  });
});
