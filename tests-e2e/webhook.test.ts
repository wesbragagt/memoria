// Webhook e2e: signature verification + live git sync, end to end over HTTP.
//
// Server env wires the git-sync adapter to a LOCAL bare repo (file:// URL) with
// a docs/ subtree, so no network/credentials are needed. The adapter checks out
// REPO_DIR and materializes the subtree at <REPO_DIR>/docs, so DOCS_DIR points
// there (verified by GETting a doc that exists only in the bare repo).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import path from "node:path";
import { startServer, type ServerHandle } from "./harness";
import { makeOrigin, commitAndPush, type Origin } from "./git-helper";

const PORT_OFFSET = 1;
const SECRET = "top-secret-e2e";

let base: string;
let repoDir: string;
let origin: Origin;
let server: ServerHandle;

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

async function postWebhook(
  event: string,
  payload: object,
  signature: string | null,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": event,
  };
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  return fetch(`${server.baseUrl}/api/github-webhook`, {
    method: "POST",
    headers,
    body,
  });
}

async function getDoc(slug: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${server.baseUrl}/docs/${slug}`);
  return { status: res.status, body: await res.text() };
}

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "memoria-e2e-hook-"));
  repoDir = path.join(base, "checkout");

  origin = await makeOrigin(base, {
    "docs/from-git.md": "# From Git\n\noriginal git content\n",
    "docs/README.md": "# Repo readme\n\nignore me\n",
  });

  server = await startServer(PORT_OFFSET, {
    WEBHOOK_SECRET: SECRET,
    DOCS_GIT_REPO: `file://${origin.bare}`,
    DOCS_GIT_REF: "main",
    DOCS_GIT_SUBTREE: "docs",
    REPO_DIR: repoDir,
    DOCS_DIR: path.join(repoDir, "docs"),
  });
});

afterAll(async () => {
  await server?.stop();
  if (base) await rm(base, { recursive: true, force: true });
});

describe("webhook + live git sync", () => {
  it("boot-clones from git: a doc only in the bare repo is served", async () => {
    // First non-healthz request triggers ensureCloned() in middleware; the
    // clone is awaited before the response, so this doc must be present.
    const doc = await getDoc("from-git");
    expect(doc.status).toBe(200);
    expect(doc.body).toContain("From Git");
    expect(doc.body).toContain("original git content");
  });

  it("rejects unsigned and wrong-secret requests with 401", async () => {
    const payload = { ref: "refs/heads/main" };

    const unsigned = await postWebhook("push", payload, null);
    expect(unsigned.status).toBe(401);

    const wrong = await postWebhook(
      "push",
      payload,
      "sha256=" +
        createHmac("sha256", "wrong-secret")
          .update(JSON.stringify(payload))
          .digest("hex"),
    );
    expect(wrong.status).toBe(401);
  });

  it("acknowledges a correctly signed ping with 200", async () => {
    const payload = { zen: "hi" };
    const body = JSON.stringify(payload);
    const res = await postWebhook("ping", payload, sign(body));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { synced: boolean };
    expect(json.synced).toBe(false);
  });

  it("ignores a signed push to a non-tracked ref (200, no sync)", async () => {
    const payload = { ref: "refs/heads/some-feature" };
    const body = JSON.stringify(payload);
    const res = await postWebhook("push", payload, sign(body));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { synced: boolean; reason?: string };
    expect(json.synced).toBe(false);
    expect(json.reason).toMatch(/untracked ref/i);

    // Content unchanged.
    const doc = await getDoc("from-git");
    expect(doc.body).toContain("original git content");
  });

  it("syncs on a signed push to main: updated + new pages appear without restart", async () => {
    // Author a change in the bare repo's docs subtree: edit an existing file and
    // add a brand-new one, then push (simulating the GitHub side of the event).
    await commitAndPush(
      origin,
      {
        "docs/from-git.md": "# From Git\n\nUPDATED git content v2\n",
        "docs/brand-new.md": "# Brand New\n\nfreshly added page\n",
      },
      "update content",
    );

    // Pre-sync: the running server still serves the OLD content and 404s the
    // not-yet-synced new page.
    expect((await getDoc("from-git")).body).toContain("original git content");
    expect((await getDoc("brand-new")).status).toBe(404);

    // Fire the signed push webhook for the tracked ref.
    const payload = { ref: "refs/heads/main" };
    const body = JSON.stringify(payload);
    const res = await postWebhook("push", payload, sign(body));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { synced: boolean };
    expect(json.synced).toBe(true);

    // Post-sync, WITHOUT restarting the server: updated content + new page.
    const updated = await getDoc("from-git");
    expect(updated.status).toBe(200);
    expect(updated.body).toContain("UPDATED git content v2");
    expect(updated.body).not.toContain("original git content");

    const brandNew = await getDoc("brand-new");
    expect(brandNew.status).toBe(200);
    expect(brandNew.body).toContain("freshly added page");
  });

  // NOTE: the WEBHOOK_SECRET-unset → 503 path is already covered by the unit
  // suite (tests/webhook.test.ts); we intentionally skip a server-less case
  // here rather than boot a second server just to re-prove it.
});
