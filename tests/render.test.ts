import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/render/render";

const known = new Set(["guides/installation", "getting-started", "guides/setup"]);

function render(md: string, opts: Partial<Parameters<typeof renderMarkdown>[1]> = {}) {
  return renderMarkdown(md, {
    slug: "guides/index",
    allowHtml: false,
    knownSlugs: known,
    ...opts,
  });
}

describe("render — link rewriting gated to real docs", () => {
  it("rewrites a relative link to a known slug, preserving the fragment", async () => {
    const { html } = await render("[Install](./installation.md#step-2)");
    expect(html).toContain('href="/docs/guides/installation#step-2"');
  });

  it("rewrites a parent-relative link resolving to a known slug", async () => {
    const { html } = await render("[Start](../getting-started.md)");
    expect(html).toContain('href="/docs/getting-started"');
  });

  it("leaves external http(s) and mailto links untouched", async () => {
    const { html } = await render(
      "[ext](https://example.com/x.md) [mail](mailto:a@b.com)",
    );
    expect(html).toContain('href="https://example.com/x.md"');
    expect(html).toContain('href="mailto:a@b.com"');
  });

  it("leaves absolute in-site links untouched", async () => {
    const { html } = await render("[abs](/docs/guides/installation)");
    expect(html).toContain('href="/docs/guides/installation"');
  });

  it("leaves in-page anchors untouched", async () => {
    const { html } = await render("[anchor](#section)");
    expect(html).toContain('href="#section"');
  });

  it("leaves out-of-tree links untouched", async () => {
    const { html } = await render("[up](../../../escape.md)", {
      slug: "guides/index",
    });
    expect(html).toContain('href="../../../escape.md"');
    expect(html).not.toContain("/docs/escape");
  });

  it("leaves links to unknown slugs untouched", async () => {
    const { html } = await render("[nope](./nonexistent.md)");
    expect(html).toContain('href="./nonexistent.md"');
    expect(html).not.toContain("/docs/guides/nonexistent");
  });
});

describe("render — mermaid", () => {
  it("emits a mermaid fence as pre.mermaid with verbatim source", async () => {
    const src = "graph TD\n  A-->B";
    const { html } = await render("```mermaid\n" + src + "\n```");
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain("graph TD");
    expect(html).toContain("A-->B"); // diagram source preserved verbatim
    // Not tokenized by the highlighter.
    expect(html).not.toContain("language-mermaid");
  });
});

describe("render — raw HTML gating", () => {
  it("strips raw HTML when allowHtml is false", async () => {
    const { html } = await render("<div class='island'>hi</div>\n\ntext", {
      allowHtml: false,
    });
    expect(html).not.toContain("<div");
    expect(html).toContain("text");
  });

  it("passes raw HTML through when allowHtml is true", async () => {
    const { html } = await render("<div class='island'>hi</div>\n\ntext", {
      allowHtml: true,
    });
    expect(html).toContain("<div");
    expect(html).toContain("island");
  });
});

describe("render — toc", () => {
  it("extracts h2/h3 headings with ids", async () => {
    const { toc } = await render(
      "# Title\n\n## First Section\n\ntext\n\n### Nested\n\nmore\n\n## Second\n",
    );
    expect(toc).toEqual([
      { depth: 2, id: "first-section", text: "First Section" },
      { depth: 3, id: "nested", text: "Nested" },
      { depth: 2, id: "second", text: "Second" },
    ]);
  });
});
