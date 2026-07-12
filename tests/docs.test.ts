import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { listDocs, getDoc, searchDocs } from "../src/domain/docs";
import { cleanup, tempDir, writeDoc } from "./helpers";

let root: string;

beforeEach(async () => {
  root = await tempDir();
  process.env.DOCS_DIR = root;
});

afterEach(async () => {
  delete process.env.DOCS_DIR;
  await cleanup(root);
});

describe("docs domain — no caching", () => {
  it("reflects edits on the next read", async () => {
    const file = await writeDoc(root, "note.md", "# Note\n\noriginal body\n");

    const first = await getDoc("note");
    expect(first?.body).toContain("original body");

    // Modify the same file; a fresh read must see the new content.
    await writeFile(file, "# Note\n\nchanged body\n", "utf8");

    const second = await getDoc("note");
    expect(second?.body).toContain("changed body");
    expect(second?.body).not.toContain("original body");
  });

  it("reflects newly-added docs in listDocs on the next call", async () => {
    await writeDoc(root, "a.md", "# A\n");
    expect((await listDocs()).map((d) => d.slug)).toEqual(["a"]);

    await writeDoc(root, "b.md", "# B\n");
    expect((await listDocs()).map((d) => d.slug)).toEqual(["a", "b"]);
  });
});

describe("docs domain — extension precedence", () => {
  it("prefers md over mdx over html on slug collision", async () => {
    await writeDoc(root, "page.html", "<p>html</p>");
    await writeDoc(root, "page.mdx", "# Mdx\n");
    await writeDoc(root, "page.md", "# Md\n\nmd wins\n");

    const doc = await getDoc("page");
    expect(doc?.format).toBe("md");
    expect(doc?.body).toContain("md wins");

    // And the list collapses the collision to a single md entry.
    const summaries = (await listDocs()).filter((d) => d.slug === "page");
    expect(summaries).toHaveLength(1);
    expect(summaries[0].format).toBe("md");
  });

  it("prefers mdx over html when no md exists", async () => {
    await writeDoc(root, "only.html", "<p>html</p>");
    await writeDoc(root, "only.mdx", "# Only\n");
    const doc = await getDoc("only");
    expect(doc?.format).toBe("mdx");
  });
});

describe("docs domain — traversal guard", () => {
  it("returns null for ../ traversal", async () => {
    await writeDoc(root, "safe.md", "# Safe\n");
    // Put a file above root that must never be reachable.
    await writeFile(path.join(root, "..", "secret.md"), "# Secret\n", "utf8").catch(
      () => {},
    );
    expect(await getDoc("../secret")).toBeNull();
    expect(await getDoc("../../etc/passwd")).toBeNull();
  });

  it("returns null for an absolute path slug", async () => {
    expect(await getDoc("/etc/passwd")).toBeNull();
    expect(await getDoc(path.join(root, "safe"))).toBeNull();
  });
});

describe("docs domain — frontmatter", () => {
  it("strips leading frontmatter from the body", async () => {
    await writeDoc(
      root,
      "fm.md",
      "---\ntitle: Custom Title\nfoo: bar\n---\n# Heading\n\nreal body\n",
    );
    const doc = await getDoc("fm");
    expect(doc?.body).not.toContain("foo: bar");
    expect(doc?.body).not.toContain("---");
    expect(doc?.body.trimStart().startsWith("# Heading")).toBe(true);
    // md title still comes from the first H1, not frontmatter.
    expect(doc?.title).toBe("Heading");
  });

  it("uses html frontmatter title", async () => {
    await writeDoc(root, "sa.html", "---\ntitle: HTML Doc\nstandalone: true\n---\n<p>x</p>");
    const doc = await getDoc("sa");
    expect(doc?.title).toBe("HTML Doc");
    expect(doc?.standalone).toBe(true);
    expect(doc?.body).not.toContain("title: HTML Doc");
  });
});

describe("docs domain — missing dir", () => {
  it("degrades to an empty list when DOCS_DIR does not exist", async () => {
    process.env.DOCS_DIR = path.join(root, "does-not-exist");
    expect(await listDocs()).toEqual([]);
    expect(await getDoc("anything")).toBeNull();
  });
});

describe("docs domain — search ranking", () => {
  it("ranks a title match above a body-only match and returns a snippet", async () => {
    // "widget" in the title of one doc, only in the body of another.
    await writeDoc(root, "widget-guide.md", "# Widget Guide\n\nSetup instructions here.\n");
    await writeDoc(
      root,
      "other.md",
      "# Other\n\nSome text mentioning a widget deep in the body content.\n",
    );

    const results = await searchDocs("widget");
    expect(results).toHaveLength(2);
    expect(results[0].doc.slug).toBe("widget-guide");
    expect(results[0].matchedIn).toBe("title");
    expect(results[1].doc.slug).toBe("other");
    expect(results[1].matchedIn).toBe("body");
    // Body match carries a snippet around the hit.
    expect(results[1].snippet.toLowerCase()).toContain("widget");
  });

  it("returns empty for a blank query", async () => {
    await writeDoc(root, "x.md", "# X\n");
    expect(await searchDocs("   ")).toEqual([]);
  });
});
