// Doc-content islands: progressive enhancement for authored HTML embedded in
// docs. Ships to the browser — NO secrets, NO engine access. Islands only ever
// talk to same-origin guarded API routes (e.g. /api/query.json), never the
// query engine directly (QUERY_ENGINE_URL never reaches the client).
//
// REGISTRY PATTERN
// ----------------
// Every island is one entry in `islands`: a CSS `selector` and a `mount`
// function that hydrates a single matched element. hydrateDocIslands(root)
// finds every instance of every island and mounts each one wrapped in
// try/catch, so a single broken embed can never block another island — or the
// rest of the page. Each island owns its own loading/error UI, rendered inline
// into its placeholder (degrade quietly, never throw to the page).
//
// EXTENSION POINT
// ---------------
// A "bespoke" island (its own dedicated renderer + its own guarded endpoint) is
// added by pushing another { selector, mount } entry here. The generic
// data-sql-table below is the only island today; it needs zero code change to
// add/edit an embed (authors ship SQL via a docs edit alone).
//
// WIRING: the doc page includes this module once. It self-executes on import
// (see bottom), hydrating document on DOMContentLoaded / immediately if the DOM
// is already parsed. hydrateDocIslands is also exported for manual re-runs.

interface Island {
  selector: string;
  /** Hydrate ONE matched element. Throwing is contained by hydrateDocIslands. */
  mount: (el: Element) => void;
}

// ---------------------------------------------------------------------------
// data-sql-table island
// ---------------------------------------------------------------------------
//
// Authored markup (in a .mdx doc, passed through raw):
//
//   <div data-sql-table data-title="Recent orders">
//     <script type="text/plain" data-sql>SELECT id, total FROM orders LIMIT 10</script>
//   </div>
//
// Behavior: read the inline SQL, POST it to /api/query.json, render a table
// (columns → headers, rows → cells), and append a "Show SQL" <details>
// disclosure. On unavailable/off/error, render quiet inline status text — the
// SQL disclosure still works so the query is always inspectable.

interface QueryResponse {
  configured: boolean;
  columns?: string[];
  rows?: unknown[][];
  truncated?: boolean;
  error?: string;
}

function readSql(container: Element): string | null {
  const script = container.querySelector<HTMLElement>("script[data-sql]");
  const text = script?.textContent ?? "";
  return text.trim() === "" ? null : text.trim();
}

function setStatus(el: HTMLElement, message: string): void {
  el.textContent = message;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function buildTable(columns: string[], rows: unknown[][]): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "sql-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (let i = 0; i < columns.length; i++) {
      const td = document.createElement("td");
      td.textContent = cellText(row[i]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}

function buildSqlDisclosure(sql: string): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "sql-source";
  const summary = document.createElement("summary");
  summary.textContent = "Show SQL";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = sql;
  pre.appendChild(code);
  details.appendChild(summary);
  details.appendChild(pre);
  return details;
}

function mountSqlTable(el: Element): void {
  const container = el as HTMLElement;
  const sql = readSql(container);

  // Build the shell: a status region + the always-available SQL disclosure.
  container.replaceChildren();

  const status = document.createElement("div");
  status.className = "sql-table-status";
  status.setAttribute("role", "status");
  container.appendChild(status);

  const title = container.getAttribute("data-title");
  if (title) {
    const caption = document.createElement("div");
    caption.className = "sql-table-title";
    caption.textContent = title;
    container.insertBefore(caption, status);
  }

  if (!sql) {
    setStatus(status, "No query provided.");
    return;
  }

  // SQL disclosure is added regardless of query outcome.
  container.appendChild(buildSqlDisclosure(sql));

  setStatus(status, "Loading live data…");

  fetch("/api/query.json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql }),
  })
    .then(async (res) => {
      const data = (await res.json()) as QueryResponse;
      if (!data.configured) {
        setStatus(status, "Live data unavailable.");
        return;
      }
      if (data.error || !data.columns || !data.rows) {
        setStatus(status, `Live data error: ${data.error ?? "unexpected response"}`);
        return;
      }
      status.remove();
      const table = buildTable(data.columns, data.rows);
      container.insertBefore(table, container.querySelector(".sql-source"));
      if (data.truncated) {
        const note = document.createElement("div");
        note.className = "sql-table-truncated";
        note.textContent = "Results truncated.";
        container.insertBefore(note, container.querySelector(".sql-source"));
      }
    })
    .catch(() => {
      setStatus(status, "Live data unavailable.");
    });
}

// ---------------------------------------------------------------------------
// Registry + hydration
// ---------------------------------------------------------------------------

const islands: Island[] = [
  { selector: "[data-sql-table]", mount: mountSqlTable },
];

/**
 * Find and mount every island within `root`. Each mount is isolated in a
 * try/catch so one failing embed never blocks another island or the page.
 */
export function hydrateDocIslands(root: ParentNode = document): void {
  for (const island of islands) {
    const nodes = root.querySelectorAll(island.selector);
    nodes.forEach((node) => {
      try {
        island.mount(node);
      } catch (err) {
        // Never let one broken island escape to the page.
        console.error("[islands] mount failed for", island.selector, err);
      }
    });
  }
}

// Self-execute on import: one `<script>` include is all the wiring the page
// needs. Guard against non-browser contexts (SSR import) defensively.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => hydrateDocIslands(document), {
      once: true,
    });
  } else {
    hydrateDocIslands(document);
  }
}
