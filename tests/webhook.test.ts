import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { redact, verifySignature } from "../src/adapters/git-repo";

const SAVE = ["WEBHOOK_SECRET", "DOCS_GIT_REPO"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of SAVE) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of SAVE) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("redact", () => {
  it("scrubs a token-bearing https URL from arbitrary error text", () => {
    const text =
      "fatal: unable to access 'https://x-access-token:ghs_abcDEF123456@github.com/org/repo.git/': 403";
    const out = redact(text);
    expect(out).not.toContain("ghs_abcDEF123456");
    expect(out).not.toContain("x-access-token:ghs_");
    expect(out).toContain("github.com/org/repo.git");
  });

  it("scrubs bare GitHub token prefixes and user:pass credentials", () => {
    expect(redact("token ghp_deadbeef01 here")).not.toContain("ghp_deadbeef01");
    expect(redact("https://user:secretpw@host/x")).not.toContain("secretpw");
    expect(redact("github_pat_11ABCDEF_secretpart")).not.toContain("secretpart");
  });
});

describe("verifySignature", () => {
  function sign(secret: string, body: string): string {
    return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  }

  it("accepts a correct HMAC over the raw body", () => {
    process.env.WEBHOOK_SECRET = "s3cr3t";
    const body = '{"ref":"refs/heads/main"}';
    expect(verifySignature(body, sign("s3cr3t", body))).toBe(true);
    // Also works on a Buffer of the same bytes.
    expect(verifySignature(Buffer.from(body), sign("s3cr3t", body))).toBe(true);
  });

  it("rejects a wrong signature", () => {
    process.env.WEBHOOK_SECRET = "s3cr3t";
    const body = '{"ref":"refs/heads/main"}';
    expect(verifySignature(body, sign("wrong", body))).toBe(false);
  });

  it("rejects a wrong prefix", () => {
    process.env.WEBHOOK_SECRET = "s3cr3t";
    const body = "x";
    const hex = createHmac("sha256", "s3cr3t").update(body).digest("hex");
    expect(verifySignature(body, "sha1=" + hex)).toBe(false);
  });

  it("rejects a null / missing header", () => {
    process.env.WEBHOOK_SECRET = "s3cr3t";
    expect(verifySignature("x", null)).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    delete process.env.WEBHOOK_SECRET;
    const body = "x";
    const hex = createHmac("sha256", "anything").update(body).digest("hex");
    expect(verifySignature(body, "sha256=" + hex)).toBe(false);
  });
});

// Route-level: unit-test the handler directly with a mocked Request. This is
// simpler and more reliable than driving the built server for auth cases, and
// exercises the real handler wiring (env read at call time).
describe("webhook route handler", () => {
  async function loadHandler() {
    vi.resetModules();
    const mod = await import("../src/pages/api/github-webhook");
    return mod.POST;
  }

  function makeCtx(body: string, headers: Record<string, string>) {
    const req = new Request("http://x/api/github-webhook", {
      method: "POST",
      headers,
      body,
    });
    return { request: req } as unknown as Parameters<
      Awaited<ReturnType<typeof loadHandler>>
    >[0];
  }

  it("returns 503 when no secret is configured", async () => {
    delete process.env.WEBHOOK_SECRET;
    const POST = await loadHandler();
    const res = await POST(makeCtx("{}", {}));
    expect(res.status).toBe(503);
  });

  it("returns 401 on an invalid signature", async () => {
    process.env.WEBHOOK_SECRET = "s3cr3t";
    const POST = await loadHandler();
    const res = await POST(
      makeCtx('{"ref":"refs/heads/main"}', {
        "x-hub-signature-256": "sha256=" + "0".repeat(64),
        "x-github-event": "push",
      }),
    );
    expect(res.status).toBe(401);
  });
});
