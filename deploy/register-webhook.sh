#!/usr/bin/env bash
#
# register-webhook.sh — Idempotent GitHub webhook registration.
#
# Registers a webhook on a GitHub repository to notify the docs site of
# push events. Uses the GitHub REST API via `gh` CLI.
#
# Prerequisites:
#   - gh CLI installed and authenticated (gh auth login)
#   - WEBHOOK_URL: the public URL of POST /api/github-webhook
#     (e.g., https://docs.example.com/api/github-webhook)
#   - WEBHOOK_SECRET: the secret for HMAC-SHA256 verification
#     (must match WEBHOOK_SECRET in the Kubernetes Secret)
#   - REPO: GitHub repo in owner/name format
#     (e.g., my-org/docs)
#
# Usage:
#   export WEBHOOK_URL="https://docs.example.com/api/github-webhook"
#   export WEBHOOK_SECRET="your-secret-here"
#   export REPO="my-org/docs"
#   ./register-webhook.sh
#
# Idempotency:
#   The script checks for an existing webhook with the same URL and updates it
#   (updating the secret) rather than creating a duplicate. This makes it safe
#   to run multiple times.

set -euo pipefail

# --- Configuration ---

# Ensure required env vars are set
if [[ -z "${WEBHOOK_URL:-}" ]]; then
  echo "ERROR: WEBHOOK_URL not set. Example: https://docs.example.com/api/github-webhook" >&2
  exit 1
fi

if [[ -z "${WEBHOOK_SECRET:-}" ]]; then
  echo "ERROR: WEBHOOK_SECRET not set." >&2
  exit 1
fi

if [[ -z "${REPO:-}" ]]; then
  echo "ERROR: REPO not set. Example: my-org/docs" >&2
  exit 1
fi

# Verify gh CLI is installed and authenticated
if ! command -v gh &> /dev/null; then
  echo "ERROR: gh CLI not found. Install it from https://cli.github.com" >&2
  exit 1
fi

if ! gh auth status > /dev/null 2>&1; then
  echo "ERROR: Not authenticated with gh. Run: gh auth login" >&2
  exit 1
fi

# --- Main logic ---

echo "[webhook] Checking for existing webhook on ${REPO}…"

# Fetch all webhooks for the repo as JSON
existing_hook=$(gh api \
  -H "Accept: application/vnd.github.v3+json" \
  "repos/${REPO}/hooks" \
  --jq ".[] | select(.config.url == \"${WEBHOOK_URL}\") | .id" \
  2>/dev/null || true)

if [[ -n "${existing_hook}" ]]; then
  echo "[webhook] Found existing webhook (id: ${existing_hook}), updating secret…"

  # Update the webhook's secret
  gh api \
    -H "Accept: application/vnd.github.v3+json" \
    -X PATCH \
    "repos/${REPO}/hooks/${existing_hook}" \
    -f "config[secret]=${WEBHOOK_SECRET}" \
    -f "config[content_type]=json" \
    > /dev/null

  echo "[webhook] Secret updated."

else
  echo "[webhook] No existing webhook found, creating…"

  # Create a new webhook
  # Events: push (on the tracked ref)
  # Content-Type: application/json
  # Active: true
  gh api \
    -H "Accept: application/vnd.github.v3+json" \
    "repos/${REPO}/hooks" \
    -f "name=web" \
    -f "active=true" \
    -f "events[]=push" \
    -f "config[url]=${WEBHOOK_URL}" \
    -f "config[secret]=${WEBHOOK_SECRET}" \
    -f "config[content_type]=json" \
    -f "config[insecure_ssl]=0" \
    > /dev/null

  echo "[webhook] Webhook created."
fi

echo
echo "[webhook] Done. Next steps:"
echo "  1. Verify the webhook in GitHub: https://github.com/${REPO}/settings/hooks"
echo "  2. Push a change to the docs to trigger a sync:"
echo "     git push origin <branch>"
echo "  3. Check the Kubernetes pod logs for sync output:"
echo "     kubectl logs -f deployment/docs-site -n docs"
echo
