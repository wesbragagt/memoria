import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { cleanup, tempDir } from "./helpers";

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await exec("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

/** Create a bare origin repo with a docs/ subtree and one commit on `main`. */
async function makeOrigin(base: string, body: string): Promise<string> {
  const work = path.join(base, "work");
  const bare = path.join(base, "origin.git");
  await mkdir(work, { recursive: true });
  await git(work, "init", "-b", "main");
  await mkdir(path.join(work, "docs"), { recursive: true });
  await writeFile(path.join(work, "docs", "hello.md"), body, "utf8");
  await git(work, "add", ".");
  await git(work, "commit", "-m", "init");
  await git(base, "clone", "--bare", work, bare);
  return bare;
}

/**
 * Import a FRESH copy of the git-repo adapter so its module-level state
 * (memoized init promise, serialization tail) does not leak between tests.
 */
async function freshAdapter() {
  vi.resetModules();
  return import("../src/adapters/git-repo");
}

let base: string;
let repoDir: string;

const ENV_KEYS = [
  "DOCS_GIT_REPO",
  "DOCS_GIT_REF",
  "REPO_DIR",
  "DOCS_GIT_SUBTREE",
] as const;
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  base = await tempDir("memoria-git-");
  repoDir = path.join(base, "checkout");
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await cleanup(base);
});

describe("git-repo — unconfigured", () => {
  it("ensureCloned is a no-op and syncToLatest degrades cleanly", async () => {
    const { ensureCloned, syncToLatest } = await freshAdapter();
    delete process.env.DOCS_GIT_REPO;
    await expect(ensureCloned()).resolves.toBeUndefined();
    expect(await syncToLatest()).toEqual({
      synced: false,
      reason: "git sync not configured",
    });
  });
});

describe("git-repo — REPO_DIR safety", () => {
  it("refuses a filesystem-root REPO_DIR", async () => {
    const { syncToLatest } = await freshAdapter();
    process.env.DOCS_GIT_REPO = "file:///nonexistent/x.git";
    process.env.REPO_DIR = "/";
    await expect(syncToLatest()).rejects.toThrow(/filesystem root/i);
  });
});

describe("git-repo — clone and preserve on failure", () => {
  it("clones content, then preserves the old checkout when re-clone fails", async () => {
    const { syncToLatest } = await freshAdapter();
    const bare = await makeOrigin(base, "# Hello\n\noriginal content\n");
    process.env.DOCS_GIT_REPO = `file://${bare}`;
    process.env.REPO_DIR = repoDir;
    process.env.DOCS_GIT_REF = "main";
    process.env.DOCS_GIT_SUBTREE = "docs";

    // Initial sync clones the subtree into the live checkout.
    const first = await syncToLatest();
    expect(first.synced).toBe(true);
    const docPath = path.join(repoDir, "docs", "hello.md");
    expect(await readFile(docPath, "utf8")).toContain("original content");

    // Destroy the origin entirely: the checkout's stored remote (fast-path
    // fetch) AND the env remote (recovery re-clone) now both point at nothing.
    await rm(bare, { recursive: true, force: true });

    // syncToLatest must fail (fetch fails, recovery re-clone fails) WITHOUT
    // having wiped the live checkout.
    await expect(syncToLatest()).rejects.toThrow();

    // The invariant: previously-served content is still on disk, intact.
    expect(await readFile(docPath, "utf8")).toContain("original content");
  });

  it("keeps serving the old content across a failed re-clone (no missing window)", async () => {
    const { syncToLatest } = await freshAdapter();
    const bare = await makeOrigin(base, "# Hello\n\noriginal content\n");
    process.env.DOCS_GIT_REPO = `file://${bare}`;
    process.env.REPO_DIR = repoDir;
    process.env.DOCS_GIT_REF = "main";
    process.env.DOCS_GIT_SUBTREE = "docs";

    const first = await syncToLatest();
    expect(first.synced).toBe(true);
    const docPath = path.join(repoDir, "docs", "hello.md");
    expect(await readFile(docPath, "utf8")).toContain("original content");

    // Break the origin so both the fast-path fetch and the recovery re-clone
    // fail. The recovery clones into staging BEFORE touching the live checkout,
    // so the failure happens while the old checkout is still fully in place —
    // DOCS_DIR is never emptied and the .git dir stays intact.
    await rm(bare, { recursive: true, force: true });
    await expect(syncToLatest()).rejects.toThrow();

    // Old content preserved, and it is a real checkout (not a half-swapped dir).
    expect(await readFile(docPath, "utf8")).toContain("original content");
    await expect(readdir(path.join(repoDir, ".git"))).resolves.toBeDefined();
  });

  it("tolerates a stale backup/staging sibling from a crashed prior run", async () => {
    const { syncToLatest } = await freshAdapter();
    const bare = await makeOrigin(base, "# Hello\n\noriginal content\n");
    process.env.DOCS_GIT_REPO = `file://${bare}`;
    process.env.REPO_DIR = repoDir;
    process.env.DOCS_GIT_REF = "main";
    process.env.DOCS_GIT_SUBTREE = "docs";

    // Simulate leftover scratch dirs a crash between the two promotion renames
    // (or during cloning) could have orphaned next to the live checkout.
    const name = path.basename(repoDir);
    const parent = path.dirname(repoDir);
    const staleStaging = path.join(parent, `${name}.staging-dead`);
    const staleBackup = path.join(parent, `${name}.backup-dead`);
    await mkdir(path.join(staleStaging, "junk"), { recursive: true });
    await mkdir(path.join(staleBackup, "junk"), { recursive: true });

    // Sync must succeed and clean the stale siblings rather than choke on them.
    const res = await syncToLatest();
    expect(res.synced).toBe(true);
    const docPath = path.join(repoDir, "docs", "hello.md");
    expect(await readFile(docPath, "utf8")).toContain("original content");

    const siblings = (await readdir(parent)).filter(
      (n) => n.startsWith(`${name}.staging-`) || n.startsWith(`${name}.backup-`),
    );
    expect(siblings).toEqual([]);
  });

  it("ensureCloned materializes the checkout on first call", async () => {
    const { ensureCloned } = await freshAdapter();
    const bare = await makeOrigin(base, "# Hi\n\nfrom ensureCloned\n");
    process.env.DOCS_GIT_REPO = `file://${bare}`;
    process.env.REPO_DIR = repoDir;
    process.env.DOCS_GIT_REF = "main";
    process.env.DOCS_GIT_SUBTREE = "docs";

    await ensureCloned();
    const docPath = path.join(repoDir, "docs", "hello.md");
    expect(await readFile(docPath, "utf8")).toContain("from ensureCloned");
  });
});
