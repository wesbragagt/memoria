import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/components/markdown";

describe("markdown — sanitization and escaping", () => {
  describe("escapeHtml in attributes", () => {
    it("escapes double quotes in href to prevent attribute breakout", () => {
      // A URL with a double quote should have the quote escaped
      const html = renderMarkdown('[link](https://example.com?x="y)');
      // The " should be escaped (we won't see a bare " followed by y in the href attribute)
      expect(html).not.toContain('"y"');
      // Verify the quote was escaped
      expect(html).toContain("quot;");
    });

    it("escapes single quotes in href to prevent attribute breakout", () => {
      const html = renderMarkdown("[link](https://example.com?x='y)");
      // The ' should be escaped
      expect(html).toContain("#39;");
    });
  });

  describe("link validation — dangerous schemes", () => {
    it("rejects javascript: URLs and renders label as plain text", () => {
      const html = renderMarkdown("[click me](javascript:alert(1))");
      // Should not contain href attribute, just escaped label
      expect(html).not.toContain("href");
      expect(html).not.toContain("javascript:");
      expect(html).toContain("click me");
    });

    it("rejects data: URLs and renders label as plain text", () => {
      const html = renderMarkdown("[click](data:text/html,<script>alert(1)</script>)");
      expect(html).not.toContain("href");
      expect(html).not.toContain("data:");
      expect(html).toContain("click");
    });

    it("rejects vbscript: URLs", () => {
      const html = renderMarkdown("[click](vbscript:msgbox(1))");
      expect(html).not.toContain("href");
      expect(html).not.toContain("vbscript:");
    });

    it("rejects protocol-relative URLs (//)", () => {
      const html = renderMarkdown("[click](//attacker.com)");
      // Should render as plain text without href
      expect(html).not.toContain('href="//attacker.com"');
      expect(html).toContain("click");
    });
  });

  describe("link validation — safe schemes and paths", () => {
    it("allows http:// URLs", () => {
      const html = renderMarkdown("[link](http://example.com)");
      expect(html).toContain('href="http://example.com"');
    });

    it("allows https:// URLs", () => {
      const html = renderMarkdown("[link](https://example.com)");
      expect(html).toContain('href="https://example.com"');
    });

    it("allows mailto: URLs", () => {
      const html = renderMarkdown("[email](mailto:test@example.com)");
      expect(html).toContain('href="mailto:test@example.com"');
    });

    it("allows absolute site-relative paths starting with /", () => {
      const html = renderMarkdown("[page](/docs/guide)");
      expect(html).toContain('href="/docs/guide"');
    });

    it("allows page anchors starting with #", () => {
      const html = renderMarkdown("[section](#introduction)");
      expect(html).toContain('href="#introduction"');
    });
  });

  describe("link label sanitization", () => {
    it("escapes HTML markup in link labels", () => {
      const html = renderMarkdown("[<script>alert(1)</script>](http://example.com)");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("escapes ampersands in link labels", () => {
      const html = renderMarkdown("[A & B](http://example.com)");
      expect(html).toContain("A &amp; B");
    });

    it("escapes quotes in link labels", () => {
      const html = renderMarkdown('[label with "quotes"](http://example.com)');
      expect(html).toContain("&quot;");
    });
  });

  describe("other formatting still works", () => {
    it("renders bold text", () => {
      const html = renderMarkdown("**bold text**");
      expect(html).toContain("<strong>bold text</strong>");
    });

    it("renders italic text", () => {
      const html = renderMarkdown("*italic text*");
      expect(html).toContain("<em>italic text</em>");
    });

    it("renders inline code", () => {
      const html = renderMarkdown("`const x = 1`");
      expect(html).toContain("<code>const x = 1</code>");
    });

    it("renders fenced code blocks", () => {
      const html = renderMarkdown("```javascript\nconst x = 1;\n```");
      expect(html).toContain("<pre><code>const x = 1;</code></pre>");
    });

    it("renders headings", () => {
      const html = renderMarkdown("## Heading");
      expect(html).toContain("<h2>Heading</h2>");
    });

    it("renders unordered lists", () => {
      const html = renderMarkdown("- item 1\n- item 2");
      expect(html).toContain("<ul>");
      expect(html).toContain("<li>item 1</li>");
      expect(html).toContain("<li>item 2</li>");
    });

    it("renders ordered lists", () => {
      const html = renderMarkdown("1. first\n2. second");
      expect(html).toContain("<ol>");
      expect(html).toContain("<li>first</li>");
      expect(html).toContain("<li>second</li>");
    });
  });

  describe("edge cases", () => {
    it("handles links with query parameters", () => {
      const html = renderMarkdown("[link](https://example.com?foo=bar&baz=qux)");
      // The & in the URL should be escaped as &amp; by escapeHtml
      expect(html).toContain("href=");
      expect(html).toContain("&amp;");
    });

    it("handles relative paths with fragments", () => {
      const html = renderMarkdown("[section](/guide#step-1)");
      expect(html).toContain('href="/guide#step-1"');
    });

    it("escapes HTML entities in code blocks", () => {
      const html = renderMarkdown("```\n<script>alert(1)</script>\n```");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
    });
  });
});
