# Set up the GitHub webhook

How to wire a GitHub repository to the update webhook so a `git push` to your
docs repo refreshes the live site — no redeploy.

## Why this matters

The webhook is what completes the zero-rebuild loop in production. Without it,
the site serves whatever it cloned at boot and only picks up changes on a pod
restart. With it, publishing a doc **is** pushing to git: GitHub notifies the
site, the site fetches the new commit, and the very next page view serves the
updated content. It is also the only public, unauthenticated endpoint in the
deployment — GitHub cannot log in through your SSO — so its HMAC signature is
the entire trust boundary. Setting it up correctly (strong secret, signed
payloads) is what lets that endpoint stay exposed safely.

## Prerequisites

- The site deployed with `DOCS_GIT_REPO` pointing at your docs repository
  (see [Install the site](install.md)).
- `/api/github-webhook` reachable from GitHub — publicly, without SSO
  (in Kubernetes: a more-specific unauthenticated ingress path; see
  `deploy/ingress.yaml` in the project repo).
- Admin access to the docs repository.

## 1. Create a strong secret

```bash
openssl rand -hex 32
```

Set it as `WEBHOOK_SECRET` on the site (Kubernetes Secret, compose `.env`,
etc.) and restart. Without it the endpoint refuses all deliveries with `503` —
it will never accept a payload it cannot verify.

## 2. Register the webhook

**Option A — the bundled script** (idempotent, uses the `gh` CLI):

```bash
WEBHOOK_URL=https://docs.example.com/api/github-webhook \
WEBHOOK_SECRET=<the secret from step 1> \
REPO=your-org/your-docs \
./deploy/register-webhook.sh
```

**Option B — GitHub UI:** repository → *Settings → Webhooks → Add webhook*:

| Field | Value |
| --- | --- |
| Payload URL | `https://docs.example.com/api/github-webhook` |
| Content type | `application/json` |
| Secret | the secret from step 1 |
| Events | *Just the push event* |

## 3. Verify

GitHub sends a `ping` on registration — the endpoint acknowledges it with
`200 {"synced":false,"reason":"ping acknowledged"}` (check *Recent
Deliveries* on the webhook page). Then push a doc change to the tracked
branch (`DOCS_GIT_REF`, default `main`) and reload the site: the change is
live, and the delivery log shows `200 {"synced":true}`.

## How deliveries are handled

| Delivery | Response |
| --- | --- |
| Valid signature, push to tracked ref | `200 {"synced":true}` — content refreshed |
| Valid signature, push to another branch | `200` acknowledged, no sync |
| Valid signature, other event (ping, etc.) | `200` acknowledged, no sync |
| Missing or wrong signature | `401` — rejected |
| `WEBHOOK_SECRET` not set on the site | `503` — cannot verify, refuses all |

## Troubleshooting

- **`401` on every delivery** — the secret on GitHub and `WEBHOOK_SECRET` on
  the site don't match. Update one; there is no partial match.
- **`200 {"synced":false, "reason":"push to untracked ref"}`** — you pushed a
  branch other than `DOCS_GIT_REF`. Push to the tracked branch or change the
  env var.
- **Delivery times out** — the endpoint isn't publicly reachable; check that
  the webhook path bypasses your SSO proxy.
- **Private repo, sync fails after delivery** — the site needs credentials to
  fetch: configure the GitHub App variables listed in the
  [configuration reference](../reference/configuration.md).
