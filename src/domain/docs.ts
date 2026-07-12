import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import fg from "fast-glob";

/** Supported doc formats, in precedence order (earlier wins on slug collision). */
export type DocFormat = "md" | "mdx" | "html";

const FORMAT_PRECEDENCE: DocFormat[] = ["md", "mdx", "html"];

/** Lightweight record for lists, trees and search — no body. */
export interface DocSummary {
  slug: string;
  format: DocFormat;
  title: string;
  /** Only meaningful for standalone HTML; false otherwise. */
  standalone: boolean;
  /** Source file mtime (ms since epoch) for "recently updated" ordering. */
  mtimeMs: number;
}

/** Full doc, including the frontmatter-stripped body. */
export interface Doc extends DocSummary {
  body: string;
}

/** A search hit: the doc summary plus a snippet and where it matched. */
export interface SearchResult {
  doc: DocSummary;
  snippet: string;
  matchedIn: "title" | "body";
}

/** Nested tree node — either a folder (with children) or a leaf doc. */
export type TreeNode =
  | {
      type: "folder";
      name: string;
      /** posix path segment prefix, e.g. "guides" */
      path: string;
      children: TreeNode[];
    }
  | {
      type: "doc";
      name: string;
      doc: DocSummary;
      active: boolean;
    };

/** Resolve the docs root lazily so tests can repoint DOCS_DIR per call. */
function docsDir(): string {
  return path.resolve(process.env.DOCS_DIR ?? "./docs");
}

/** posix-normalized slug from an absolute file path relative to the docs root. */
function toSlug(absFile: string, root: string): string {
  const rel = path.relative(root, absFile);
  const withoutExt = rel.slice(0, rel.length - path.extname(rel).length);
  return withoutExt.split(path.sep).join("/");
}

function formatOf(absFile: string): DocFormat {
  return path.extname(absFile).slice(1).toLowerCase() as DocFormat;
}

/**
 * Strip a leading `---\n...\n---` frontmatter block.
 * Returns the parsed flat key/value map and the remaining body.
 * No YAML — only top-level `key: value` lines.
 */
function parseFrontmatter(raw: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

/** kebab/snake/space-separated basename → Title Case. */
function humanize(slug: string): string {
  const base = slug.split("/").pop() ?? slug;
  return base
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Resolve title:
 *  - md/mdx: first `# H1`, else humanized filename
 *  - html: `title:` frontmatter, else humanized filename
 */
function resolveTitle(
  format: DocFormat,
  slug: string,
  body: string,
  data: Record<string, string>,
): string {
  if (format === "html") {
    return data.title?.trim() || humanize(slug);
  }
  const h1 = /^#\s+(.+)$/m.exec(body);
  if (h1) return h1[1].trim();
  return humanize(slug);
}

function isStandalone(format: DocFormat, data: Record<string, string>): boolean {
  return format === "html" && /^(true|yes|1)$/i.test(data.standalone ?? "");
}

/** Read + parse a single file into a full Doc. */
async function readDoc(
  absFile: string,
  slug: string,
  format: DocFormat,
): Promise<Doc> {
  const [raw, st] = await Promise.all([
    readFile(absFile, "utf8"),
    stat(absFile),
  ]);
  const { data, body } = parseFrontmatter(raw);
  return {
    slug,
    format,
    title: resolveTitle(format, slug, body, data),
    standalone: isStandalone(format, data),
    mtimeMs: st.mtimeMs,
    body,
  };
}

/**
 * Glob the docs tree, collapsing slug collisions by extension precedence.
 * Returns a slug → { absFile, format } map. Missing dir → empty map.
 */
async function scan(
  root: string,
): Promise<Map<string, { absFile: string; format: DocFormat }>> {
  const entries = await fg("**/*.{md,mdx,html}", {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    suppressErrors: true,
  });

  const bySlug = new Map<string, { absFile: string; format: DocFormat }>();
  for (const absFile of entries) {
    const slug = toSlug(absFile, root);
    const format = formatOf(absFile);
    const existing = bySlug.get(slug);
    if (
      !existing ||
      FORMAT_PRECEDENCE.indexOf(format) < FORMAT_PRECEDENCE.indexOf(existing.format)
    ) {
      bySlug.set(slug, { absFile, format });
    }
  }
  return bySlug;
}

/**
 * List every doc as a summary. Reads the filesystem on every call — no caching.
 * Missing docs dir degrades to an empty list.
 */
export async function listDocs(): Promise<DocSummary[]> {
  const root = docsDir();
  const bySlug = await scan(root);
  const docs = await Promise.all(
    [...bySlug].map(async ([slug, { absFile, format }]) => {
      const doc = await readDoc(absFile, slug, format);
      const { body: _body, ...summary } = doc;
      return summary;
    }),
  );
  return docs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Resolve a slug to a full doc, reading fresh from disk. No caching.
 * Path-traversal attempts and unknown slugs return null (never throw).
 */
export async function getDoc(slug: string): Promise<Doc | null> {
  const root = docsDir();

  // Reject traversal: the resolved candidate path must stay inside root.
  const candidate = path.resolve(root, slug);
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;

  // Match glob's discovery + precedence exactly so listDocs/getDoc agree.
  const bySlug = await scan(root);
  const hit = bySlug.get(slug.split(path.sep).join("/"));
  if (!hit) return null;

  try {
    return await readDoc(hit.absFile, slug.split(path.sep).join("/"), hit.format);
  } catch {
    return null;
  }
}

/** Build a snippet window around an index in text (defaults to text start). */
function snippetAround(text: string, index: number, radius = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (index < 0) return flat.slice(0, radius * 2).trim();
  // Re-locate the match in the flattened text approximately by taking the
  // same-cased search below; simplest reliable approach is to work on `flat`.
  const start = Math.max(0, index - radius);
  const end = Math.min(flat.length, index + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return prefix + flat.slice(start, end).trim() + suffix;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

/**
 * Search all docs at request time — always reflects current content.
 * Ranking: title matches rank above body matches; ties broken by occurrence
 * count (desc), then slug (asc). Case-insensitive.
 */
export async function searchDocs(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const root = docsDir();
  const bySlug = await scan(root);

  const results: (SearchResult & { rank: number; count: number })[] = [];

  await Promise.all(
    [...bySlug].map(async ([slug, { absFile, format }]) => {
      let doc: Doc;
      try {
        doc = await readDoc(absFile, slug, format);
      } catch {
        return;
      }
      const { body, ...summary } = doc;

      const titleLower = summary.title.toLowerCase();
      const flatBody = body.replace(/\s+/g, " ").trim();
      const flatBodyLower = flatBody.toLowerCase();

      const titleCount = countOccurrences(titleLower, q);
      const bodyCount = countOccurrences(flatBodyLower, q);

      if (titleCount > 0) {
        // Title match: snippet from body start (or around first body hit).
        const bodyIdx = flatBodyLower.indexOf(q);
        results.push({
          doc: summary,
          snippet:
            bodyIdx >= 0
              ? snippetAround(flatBody, bodyIdx)
              : flatBody.slice(0, 120).trim(),
          matchedIn: "title",
          rank: 0,
          count: titleCount + bodyCount,
        });
      } else if (bodyCount > 0) {
        const bodyIdx = flatBodyLower.indexOf(q);
        results.push({
          doc: summary,
          snippet: snippetAround(flatBody, bodyIdx),
          matchedIn: "body",
          rank: 1,
          count: bodyCount,
        });
      }
    }),
  );

  results.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.count - a.count ||
      a.doc.slug.localeCompare(b.doc.slug),
  );

  return results.map(({ doc, snippet, matchedIn }) => ({
    doc,
    snippet,
    matchedIn,
  }));
}

/**
 * Fold a flat doc list into a nested folder/doc tree mirroring disk.
 * Folders sort before docs; both alphabetical. If activeSlug matches a doc,
 * its node is flagged active.
 */
export function buildTree(
  docs: DocSummary[],
  activeSlug?: string,
): TreeNode[] {
  interface FolderBuild {
    type: "folder";
    name: string;
    path: string;
    childFolders: Map<string, FolderBuild>;
    childDocs: DocSummary[];
  }

  const root: FolderBuild = {
    type: "folder",
    name: "",
    path: "",
    childFolders: new Map(),
    childDocs: [],
  };

  for (const doc of docs) {
    const parts = doc.slug.split("/");
    const dirs = parts.slice(0, -1);
    let cursor = root;
    for (const dir of dirs) {
      let next = cursor.childFolders.get(dir);
      if (!next) {
        next = {
          type: "folder",
          name: dir,
          path: cursor.path ? `${cursor.path}/${dir}` : dir,
          childFolders: new Map(),
          childDocs: [],
        };
        cursor.childFolders.set(dir, next);
      }
      cursor = next;
    }
    cursor.childDocs.push(doc);
  }

  const emit = (folder: FolderBuild): TreeNode[] => {
    const folders = [...folder.childFolders.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map<TreeNode>((f) => ({
        type: "folder",
        name: f.name,
        path: f.path,
        children: emit(f),
      }));

    const leaves = [...folder.childDocs]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map<TreeNode>((doc) => ({
        type: "doc",
        name: doc.title,
        doc,
        active: activeSlug !== undefined && doc.slug === activeSlug,
      }));

    return [...folders, ...leaves];
  };

  return emit(root);
}
