# Deployment Guide: Reusable Live-SSR Docs Site

This directory contains Kubernetes manifests and automation for deploying the live-SSR docs site to a cluster.

## Overview

The docs site is deployed as:
- **One replica** (stateful git-synced content; see k8s.yaml for details)
- **SSO-gated** root path + doc endpoints (nginx auth annotations)
- **Public** webhook endpoint for git push notifications (HMAC-SHA256 verified)
- **Graceful shutdown** for draining in-flight requests

## Prerequisites

- A Kubernetes cluster (1.24+) with:
  - nginx ingress controller (or another controller supporting auth annotations)
  - cert-manager (optional, for automatic TLS)
- `gh` CLI installed and authenticated (`gh auth login`) for webhook registration
- A GitHub repository containing your docs (or similar git host with webhooks)
- A container image built from the repo (Dockerfile included; see `docker:build` script)
- An SSO/OIDC proxy running in-cluster (e.g., oauth2-proxy)

## Quick Start

### 1. Create the Kubernetes Secret

Replace placeholders in `k8s.yaml` Secret and create it:

```bash
kubectl create namespace docs
kubectl apply -f k8s.yaml -n docs
```

**Critical secrets to set:**
- `DOCS_GIT_REPO`: Git clone URL (with credentials for private repos)
- `WEBHOOK_SECRET`: A strong, unique secret for HMAC verification

### 2. Build and push the container image

```bash
docker build -t myregistry.com/docs-site:latest .
docker push myregistry.com/docs-site:latest
```

Update the `image:` field in `k8s.yaml` with your registry/image.

### 3. Create the Deployment and Service

```bash
kubectl apply -f k8s.yaml -n docs
```

Watch the pod start:

```bash
kubectl get pods -n docs -w
kubectl logs -f deployment/docs-site -n docs
```

The pod will take 30–60s to start (cloning the docs repo). Once ready, it should report `/healthz: ok`.

### 4. Apply the Ingress (SSO gating + public webhook)

Update the domain and auth-url/auth-signin annotations in `ingress.yaml`:
- Replace `docs.example.com` with your domain
- Replace oauth2-proxy service endpoints with your auth service (or remove auth annotations if not using oauth2-proxy)

```bash
kubectl apply -f ingress.yaml -n docs
```

Verify the Ingress is ready:

```bash
kubectl get ingress -n docs
kubectl describe ingress docs-site-gated -n docs
```

### 5. Register the webhook

Export the webhook URL and secret, then run the registration script:

```bash
export WEBHOOK_URL="https://docs.example.com/api/github-webhook"
export WEBHOOK_SECRET="<value from k8s.yaml Secret>"
export REPO="org/docs-repo"

./register-webhook.sh
```

The script is idempotent; re-running it will update the secret if the webhook already exists.

### 6. Verify the setup

Push a change to your docs repo on the tracked branch (default: `main`):

```bash
# Edit a doc file
git add docs/example.md
git commit -m "Test webhook sync"
git push origin main
```

Check the pod logs for sync output:

```bash
kubectl logs -f deployment/docs-site -n docs | grep -i webhook
```

Verify the change is live:

```bash
curl https://docs.example.com/  # should redirect to your auth service
```

## Configuration

### Environment Variables

| Variable | Default | Required | Purpose |
|----------|---------|----------|---------|
| `DOCS_GIT_REPO` | - | Yes | Git clone URL (e.g., `https://token@github.com/org/docs.git`) |
| `DOCS_GIT_REF` | `main` | No | Branch/tag to track |
| `DOCS_GIT_SUBTREE` | `.` | No | Path inside repo (e.g., `docs/` or `.`) |
| `REPO_DIR` | `/data/repo` | No | Where git-sync clones to (mounted from emptyDir) |
| `DOCS_DIR` | `/data/repo/docs` | No | Where the server looks for `.md`/`.mdx`/`.html` files |
| `WEBHOOK_SECRET` | - | Yes | HMAC-SHA256 secret for GitHub webhook verification |
| `GITHUB_APP_ID` | - | No | GitHub App ID (for webhook auth via app) |
| `GITHUB_APP_INSTALLATION_ID` | - | No | GitHub App installation ID |
| `GITHUB_APP_PRIVATE_KEY` | - | No | GitHub App private key (PEM-encoded) |
| `OPENROUTER_API_KEY` | - | No | API key for AI chat ("Ask the docs") |
| `HOST` | `0.0.0.0` | No | Server bind address |
| `PORT` | `4321` | No | Server listen port |
| `NODE_ENV` | `production` | No | Node environment |
| `SHUTDOWN_GRACE_MS` | `10000` | No | Graceful shutdown timeout (ms) |

### Persistent vs. Ephemeral Storage

By default, `k8s.yaml` uses `emptyDir` for `/data`. This means:
- **Pros:** Simple, no PVC setup needed, no cross-node constraints
- **Cons:** Pod restart = re-clone the entire docs repo (adds startup latency)

To persist across pod restarts, create a PVC and edit the `volumes:` section in `k8s.yaml`:

```yaml
volumes:
  - name: data
    persistentVolumeClaim:
      claimName: docs-data-pvc
```

Then create the PVC in advance:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: docs-data-pvc
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: standard
  resources:
    requests:
      storage: 10Gi
```

### SSO/Auth Gating

The `ingress.yaml` uses nginx auth annotations pointing to oauth2-proxy. To integrate with a different auth service:

1. Deploy your auth proxy in-cluster (oauth2-proxy, Dex, etc.)
2. Update `nginx.ingress.kubernetes.io/auth-url` to point to its verification endpoint
3. Update `nginx.ingress.kubernetes.io/auth-signin` to point to its login endpoint
4. Adjust `auth-response-headers` based on headers your auth service provides

### Webhook Path Specificity

The two Ingress resources (gated root + public webhook) rely on path specificity:
- More specific path (`/api/github-webhook`) matches before less specific (`/`)
- Both have the same host (`docs.example.com`), so the nginx ingress controller routes based on path length
- If your ingress controller does not respect path specificity, combine both into one Ingress with path-based routing rules (set `nginx.ingress.kubernetes.io/auth-url` only on the root path)

## Troubleshooting

### Pod won't start (stuck in `ContainerCreating`)

- Check image pull: `kubectl describe pod <pod-name> -n docs`
- Verify the image exists in your registry
- Check node resources: `kubectl describe nodes`

### Pod crashes with git clone error

- Verify `DOCS_GIT_REPO` is correct and credentials are valid
- Check pod logs: `kubectl logs <pod-name> -n docs`
- If using SSH, ensure the deploy key is mounted or in the container

### Webhook not triggering sync

- Verify webhook is registered: `gh api repos/ORG/REPO/hooks`
- Check webhook delivery logs in GitHub (repo Settings > Webhooks > Recent Deliveries)
- Verify the public path is not blocked by auth (check Ingress routes)
- Ensure `WEBHOOK_SECRET` matches the secret registered with GitHub

### Docs changes not showing up

- Verify the pod has synced: `kubectl logs <pod-name> -n docs | grep -i "git\|webhook"`
- Check that DOCS_DIR points to the correct location in the cloned repo
- Manually trigger a sync by pushing a change: `git push origin main`
- Force a pod restart to re-clone: `kubectl rollout restart deployment/docs-site -n docs`

## Advanced

### Custom CA certificates

If your git host uses a self-signed certificate, mount it into the container:

```yaml
volumeMounts:
  - name: ca-cert
    mountPath: /etc/ssl/certs/custom-ca.pem
    subPath: custom-ca.pem
volumes:
  - name: ca-cert
    configMap:
      name: custom-ca
```

Then set `GIT_SSL_CAINFO=/etc/ssl/certs/custom-ca.pem` in env.

### Scaling (advanced)

Running more than one replica requires external state management (e.g., a shared PVC or an external sync service). For typical doc-site loads, one replica is sufficient. If you need scale:

1. Use a shared PVC instead of emptyDir
2. Or decouple sync: run a separate git-sync worker that pushes updates to all replicas via a queue
3. Or use a StatefulSet with one sync leader and read-only followers

## Support

For issues with the docs site itself (rendering, search, AI), check the GitHub repo or ask the maintainers.

For Kubernetes deployment questions, refer to your cluster's documentation or contact your platform team.
