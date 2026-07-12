// Hermetic git helpers for the webhook e2e suite. Builds a bare origin repo
// with a docs/ subtree so the server's git-sync adapter can clone/fetch from a
// file:// URL — no network, no credentials. Commits pin author/committer env
// (same pattern as tests/git-repo.test.ts) so they are reproducible.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const exec = promisify(execFile);

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

export async function git(cwd: string, ...args: string[]): Promise<void> {
  await exec("git", args, { cwd, env: { ...process.env, ...GIT_ENV } });
}

export interface Origin {
  /** Bare repo path — pass as file://<bare> to DOCS_GIT_REPO. */
  bare: string;
  /** Working clone used to author commits, then pushed to `bare`. */
  work: string;
}

/**
 * Create a working repo + bare mirror. `files` maps a repo-relative path (e.g.
 * "docs/hello.md") to its content; committed on `main`.
 */
export async function makeOrigin(
  base: string,
  files: Record<string, string>,
): Promise<Origin> {
  const work = path.join(base, "work");
  const bare = path.join(base, "origin.git");
  await mkdir(work, { recursive: true });
  await git(work, "init", "-b", "main");
  await writeFiles(work, files);
  await git(work, "add", ".");
  await git(work, "commit", "-m", "init");
  await git(base, "clone", "--bare", work, bare);
  // Point the working clone at the bare so later commits can be pushed.
  await git(work, "remote", "add", "origin", bare);
  return { bare, work };
}

/**
 * Commit `files` on top of the current `main` in the working clone and push to
 * the bare origin — simulating a GitHub push the webhook will then fetch.
 */
export async function commitAndPush(
  origin: Origin,
  files: Record<string, string>,
  message: string,
): Promise<void> {
  await writeFiles(origin.work, files);
  await git(origin.work, "add", ".");
  await git(origin.work, "commit", "-m", message);
  await git(origin.work, "push", "origin", "main");
}

async function writeFiles(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
}
