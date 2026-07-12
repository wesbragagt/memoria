// GitHub content-update webhook (thin entrypoint — all logic in the adapter).
//
// Public, unauthenticated endpoint secured by HMAC signature verification.
// Flow: read RAW body (signature is over raw bytes) → verify → parse → match
// ref → syncToLatest. Responses:
//   - git sync unconfigured        → 200 { synced:false, reason }
//   - WEBHOOK_SECRET unconfigured  → 503 (cannot verify)
//   - missing/invalid signature    → 401
//   - push to a non-tracked ref    → 200 { synced:false, reason } (acked)
//   - non-push event               → 200 { synced:false, reason } (acked)
//   - verified push to tracked ref → 200 { synced:true }
//   - sync error                   → 500 (redacted message)
import type { APIRoute } from "astro";
import {
  verifySignature,
  webhookConfigured,
  syncToLatest,
  trackedRef,
  redact,
} from "../../adapters/git-repo";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const POST: APIRoute = async ({ request }) => {
  // Without a secret we cannot verify — refuse rather than accept blindly.
  if (!webhookConfigured()) {
    return json({ synced: false, reason: "webhook not configured" }, 503);
  }

  // Raw bytes: the signature is computed over the exact body GitHub sent.
  const raw = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifySignature(raw, signature)) {
    return json({ synced: false, reason: "invalid signature" }, 401);
  }

  const event = request.headers.get("x-github-event");
  if (event === "ping") {
    return json({ synced: false, reason: "ping acknowledged" }, 200);
  }
  if (event !== "push") {
    return json({ synced: false, reason: `ignored event: ${event}` }, 200);
  }

  let payload: { ref?: string };
  try {
    payload = JSON.parse(raw.toString("utf8")) as { ref?: string };
  } catch {
    return json({ synced: false, reason: "invalid JSON body" }, 400);
  }

  // GitHub push refs look like "refs/heads/main"; match the tracked ref.
  const pushed = payload.ref ?? "";
  const ref = trackedRef();
  if (pushed !== `refs/heads/${ref}` && pushed !== ref) {
    return json(
      { synced: false, reason: `push to untracked ref: ${pushed}` },
      200,
    );
  }

  try {
    const result = await syncToLatest();
    return json(result, 200);
  } catch (err) {
    const msg = redact(err instanceof Error ? err.message : String(err));
    return json({ synced: false, reason: msg }, 500);
  }
};
