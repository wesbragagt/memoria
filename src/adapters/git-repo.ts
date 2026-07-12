/**
 * Git content sync adapter (server-only).
 *
 * Syncs a docs subtree from a remote git repo into a writable volume at
 * runtime. The app reads content via DOCS_DIR (deployment points it into the
 * checkout, e.g. /data/repo/docs) — this adapter never imports the domain.
 *
 * Design decisions encapsulated here:
 *  - All git-technology concerns and secrets live in this module.
 *  - Env is read at CALL TIME (not module load) so tests/dev can repoint it.
 *  - When DOCS_GIT_REPO is unset, everything is a clean no-op: same code path
 *    runs locally and in tests with no git binary needed.
 *  - Git ops are serialized behind a single in-flight promise (mutex) so a
 *    webhook-triggered fetch can't race the boot clone or another fetch.
 *  - A GitHub App token (if configured) is minted per op, injected via a
 *    per-invocation `-c remote.origin.url=<tokenized>` so it is NEVER written
 *    to .git/config, and is redacted from every log line / error message.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHmac, timingSafeEqual, createSign, randomUUID } from "node:crypto";
import { mkdir, rm, rename, access, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { resolve as pathResolve } from "node:path";

const execFileAsync = promisify(execFile);

/** Result of a sync attempt. `synced:false` with a reason is a clean degrade. */
export interface SyncResult {
  synced: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Config (read at call time)
// ---------------------------------------------------------------------------

interface Config {
  repoUrl: string | undefined;
  ref: string;
  repoDir: string;
  subtree: string;
  appId: string | undefined;
  installationId: string | undefined;
  privateKey: string | undefined;
}

function config(): Config {
  return {
    repoUrl: emptyToUndefined(process.env.DOCS_GIT_REPO),
    ref: emptyToUndefined(process.env.DOCS_GIT_REF) ?? "main",
    repoDir: emptyToUndefined(process.env.REPO_DIR) ?? "/data/repo",
    subtree: emptyToUndefined(process.env.DOCS_GIT_SUBTREE) ?? "docs",
    appId: emptyToUndefined(process.env.GITHUB_APP_ID),
    installationId: emptyToUndefined(process.env.GITHUB_APP_INSTALLATION_ID),
    privateKey: emptyToUndefined(process.env.GITHUB_APP_PRIVATE_KEY),
  };
}

function emptyToUndefined(v: string | undefined): string | undefined {
  return v && v.trim() !== "" ? v : undefined;
}

/**
 * Refuse to operate on a filesystem root or empty path — this guards the
 * destructive swap/rm in stage-then-swap against catastrophic misconfig.
 */
function assertSafeRepoDir(dir: string): string {
  const resolved = pathResolve(dir);
  if (!dir || dir.trim() === "") {
    throw new Error("REPO_DIR is empty — refusing to operate.");
  }
  if (resolved === "/" || path.dirname(resolved) === resolved) {
    throw new Error(
      `REPO_DIR resolves to a filesystem root (${resolved}) — refusing to operate.`,
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Token redaction
// ---------------------------------------------------------------------------

/**
 * Scrub secrets from any text before it is logged or rethrown. Git echoes its
 * argv (including tokenized remote URLs) in error output, so this must run on
 * every git error message.
 *
 * Redacts:
 *  - `x-access-token:<token>@` credentials in URLs
 *  - `user:pass@` style credentials in URLs
 *  - GitHub token prefixes (ghs_, ghp_, github_pat_, gho_, ghu_, ghr_)
 */
export function redact(text: string): string {
  if (!text) return text;
  return text
    .replace(/x-access-token:[^@\s]+@/gi, "x-access-token:***@")
    .replace(/\/\/[^/@\s:]+:[^@\s]+@/g, "//***:***@")
    .replace(/gh[psuor]_[A-Za-z0-9]+/g, "***")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "***");
}

/** Wrap an error so its message/stack never leaks a token. */
function redactError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const wrapped = new Error(redact(msg));
  return wrapped;
}

// ---------------------------------------------------------------------------
// GitHub App auth (manual RS256 JWT — no jsonwebtoken dep)
// ---------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Sign a short-lived (10 min) RS256 JWT identifying the GitHub App. */
function mintAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(privateKey));
  return `${signingInput}.${signature}`;
}

/**
 * Exchange the App JWT for a short-lived installation access token.
 * Returns undefined when App creds are not fully configured (public/anon repo).
 */
async function installationToken(cfg: Config): Promise<string | undefined> {
  if (!cfg.appId || !cfg.installationId || !cfg.privateKey) return undefined;
  const jwt = mintAppJwt(cfg.appId, cfg.privateKey);
  const res = await fetch(
    `https://api.github.com/app/installations/${cfg.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "memoria-docs-sync",
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `GitHub App token exchange failed: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("GitHub App token exchange returned no token");
  return body.token;
}

/**
 * Build the effective remote URL for a single git invocation. If a token is
 * present, inject it as x-access-token into the HTTPS URL. The tokenless URL
 * is what stays stored in .git/config; the tokenized form is only ever passed
 * via `-c remote.origin.url=` per invocation and never persisted.
 */
function tokenizedUrl(repoUrl: string, token: string | undefined): string {
  if (!token) return repoUrl;
  try {
    const u = new URL(repoUrl);
    if (u.protocol !== "https:") return repoUrl;
    u.username = "x-access-token";
    u.password = token;
    return u.toString();
  } catch {
    return repoUrl;
  }
}

// ---------------------------------------------------------------------------
// Low-level git helpers (execFile — never shell interpolation)
// ---------------------------------------------------------------------------

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 1024 * 1024 * 64,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch (err) {
    throw redactError(err);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove stale *.lock files in .git that a crashed prior process may have left
 * (index.lock, shallow.lock, HEAD.lock, refs locks, etc.). Safe to run before
 * every fetch — git only holds these transiently while running.
 */
async function removeStaleLocks(repoDir: string): Promise<void> {
  const gitDir = path.join(repoDir, ".git");
  await removeLocksIn(gitDir);
  await removeLocksIn(path.join(gitDir, "refs", "heads"));
  await removeLocksIn(path.join(gitDir, "refs", "remotes", "origin"));
}

async function removeLocksIn(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((n) => n.endsWith(".lock"))
      .map((n) => unlink(path.join(dir, n)).catch(() => {})),
  );
}

/**
 * Clone the repo shallow + blobless + sparse into `dest`. Only the configured
 * subtree is materialized. `dest` must not already exist.
 */
async function cloneInto(dest: string, cfg: Config): Promise<void> {
  const token = await installationToken(cfg);
  const tokenized = tokenizedUrl(cfg.repoUrl!, token);
  await mkdir(path.dirname(dest), { recursive: true });

  // Clone using the tokenized URL as the positional arg. Git records that URL
  // in .git/config, so immediately after we rewrite the stored remote to the
  // tokenless form — the token never persists at rest.
  await git(path.dirname(dest), [
    "clone",
    "--depth",
    "1",
    "--filter=blob:none",
    "--no-checkout",
    "--branch",
    cfg.ref,
    tokenized,
    dest,
  ]);

  // Ensure the STORED remote is tokenless regardless of how clone recorded it.
  await git(dest, ["remote", "set-url", "origin", cfg.repoUrl!]);

  await git(dest, ["sparse-checkout", "set", cfg.subtree]);
  await git(dest, ["checkout", cfg.ref]);
}

/**
 * Fetch + hard-reset an existing checkout to the tip of the tracked ref.
 * The tokenized remote URL is injected per-invocation via -c.
 */
async function fetchAndReset(repoDir: string, cfg: Config): Promise<void> {
  await removeStaleLocks(repoDir);
  const token = await installationToken(cfg);
  const tokenized = tokenizedUrl(cfg.repoUrl!, token);

  const remoteOverride = token
    ? ["-c", `remote.origin.url=${tokenized}`]
    : [];

  await git(repoDir, [
    ...remoteOverride,
    "fetch",
    "--depth",
    "1",
    "origin",
    cfg.ref,
  ]);
  await git(repoDir, ["reset", "--hard", "FETCH_HEAD"]);
  // Re-apply sparse checkout in case the subtree config drifted.
  await git(repoDir, ["sparse-checkout", "set", cfg.subtree]);
  await git(repoDir, ["checkout", "--", "."]).catch(() => {});
}

// ---------------------------------------------------------------------------
// Serialization mutex — one git op at a time
// ---------------------------------------------------------------------------

let tail: Promise<unknown> = Promise.resolve();

/** Run `fn` only after all previously-enqueued git ops settle. */
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  // Keep the chain alive even if a link rejects; swallow here, not for callers.
  tail = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------
// Memoized initial clone (retry-on-failure)
// ---------------------------------------------------------------------------

let initPromise: Promise<void> | null = null;

/**
 * Ensure the initial checkout exists. Memoized: concurrent/subsequent callers
 * share one clone. A FAILED init clears the memo so the next call retries.
 * No-op (resolves immediately) when DOCS_GIT_REPO is unset.
 */
export function ensureCloned(): Promise<void> {
  const cfg = config();
  if (!cfg.repoUrl) return Promise.resolve();

  if (initPromise) return initPromise;

  initPromise = serialize(async () => {
    const repoDir = assertSafeRepoDir(cfg.repoDir);
    if (await exists(path.join(repoDir, ".git"))) return; // already cloned
    // Clone into staging then swap into place, so a partial clone never
    // becomes the live checkout.
    const staging = `${repoDir}.staging-${randomUUID()}`;
    await rm(staging, { recursive: true, force: true });
    try {
      await cloneInto(staging, cfg);
      await rm(repoDir, { recursive: true, force: true });
      await rename(staging, repoDir);
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }).catch((err) => {
    initPromise = null; // allow retry on next request
    throw err;
  });

  return initPromise;
}

// ---------------------------------------------------------------------------
// Sync to latest (fetch+reset with stage-then-swap fallback)
// ---------------------------------------------------------------------------

/**
 * Refresh the live checkout to the tip of the tracked ref.
 *  - Unconfigured → { synced:false, reason }.
 *  - Fast path: in-place fetch + hard reset.
 *  - On any failure (corruption, missing objects): re-clone into a sibling
 *    staging dir and atomically swap in ONLY on success. The live checkout is
 *    never deleted before its replacement is fully ready, so a transient
 *    failure can never wipe currently-served content.
 */
export function syncToLatest(): Promise<SyncResult> {
  const cfg = config();
  if (!cfg.repoUrl) {
    return Promise.resolve({
      synced: false,
      reason: "git sync not configured",
    });
  }

  return serialize<SyncResult>(async () => {
    const repoDir = assertSafeRepoDir(cfg.repoDir);

    // If never cloned, do the initial clone via the same stage-then-swap path.
    if (!(await exists(path.join(repoDir, ".git")))) {
      await stageAndSwap(repoDir, cfg);
      return { synced: true };
    }

    try {
      await fetchAndReset(repoDir, cfg);
      return { synced: true };
    } catch {
      // Recovery: rebuild in staging, swap only if the fresh clone succeeds.
      await stageAndSwap(repoDir, cfg);
      return { synced: true };
    }
  });
}

/** Clone fresh into a sibling dir and atomically replace the live checkout. */
async function stageAndSwap(repoDir: string, cfg: Config): Promise<void> {
  const staging = `${repoDir}.staging-${randomUUID()}`;
  await rm(staging, { recursive: true, force: true });
  try {
    await cloneInto(staging, cfg); // if this throws, live checkout untouched
    await rm(repoDir, { recursive: true, force: true });
    await rename(staging, repoDir);
    // Successful swap means the memoized init is now valid.
    initPromise = Promise.resolve();
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Webhook signature verification (timing-safe HMAC SHA-256)
// ---------------------------------------------------------------------------

/** True when WEBHOOK_SECRET is set; the webhook cannot verify without it. */
export function webhookConfigured(): boolean {
  return emptyToUndefined(process.env.WEBHOOK_SECRET) !== undefined;
}

/** The tracked ref (e.g. "main"), used by the webhook to match push events. */
export function trackedRef(): string {
  return config().ref;
}

/**
 * Verify a GitHub `X-Hub-Signature-256: sha256=<hex>` header against the raw
 * request body using WEBHOOK_SECRET. Timing-safe. Returns false on any missing
 * config, malformed header, or mismatch — never throws.
 */
export function verifySignature(
  rawBody: Buffer | string,
  signatureHeader: string | null,
): boolean {
  const secret = emptyToUndefined(process.env.WEBHOOK_SECRET);
  if (!secret || !signatureHeader) return false;

  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match) return false;

  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = createHmac("sha256", secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(match[1], "hex");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
