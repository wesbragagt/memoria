/**
 * Tiny, dependency-free Markdown → safe HTML renderer for chat answers. Covers
 * the subset an assistant realistically emits: headings, bold/italic, inline
 * code, fenced code blocks, links, and unordered/ordered lists. All user input
 * is HTML-escaped and validated. Links are validated against a safe-scheme
 * allowlist (http:, https:, mailto:, and site-relative paths) before rendering.
 *
 * This is intentionally minimal — not a spec-complete parser. It exists so the
 * chat UI ships zero markdown dependencies while still reading nicely.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidLinkHref(href: string): boolean {
  // Reject protocol-relative URLs (// is dangerous)
  if (href.startsWith("//")) return false;
  // Allow http://, https://, mailto:, and site-relative paths (/ or #)
  if (href.startsWith("http://") || href.startsWith("https://")) return true;
  if (href.startsWith("mailto:")) return true;
  if (href.startsWith("/") || href.startsWith("#")) return true;
  return false;
}

function inline(text: string): string {
  let out = escapeHtml(text);
  // inline code first so its contents aren't further formatted
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label, href) => {
      if (!isValidLinkHref(href)) {
        // Reject dangerous schemes; render as escaped text
        return escapeHtml(label);
      }
      return `<a href="${escapeHtml(href)}">${label}</a>`;
    },
  );
  return out;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;

  const flushList = (buf: string[], ordered: boolean) => {
    if (!buf.length) return;
    const tag = ordered ? "ol" : "ul";
    html.push(`<${tag}>${buf.map((li) => `<li>${inline(li)}</li>`).join("")}</${tag}>`);
    buf.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    // heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      flushList(buf, false);
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      flushList(buf, true);
      continue;
    }

    // blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // paragraph (gather consecutive non-blank, non-structural lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    html.push(`<p>${inline(para.join(" "))}</p>`);
  }

  return html.join("");
}
