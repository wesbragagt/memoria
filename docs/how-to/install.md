# Install the site

How to run Memoria locally and in production.

## Locally

```bash
npm install
npm run dev
```

Point it at your own content with `DOCS_DIR=/path/to/docs npm run dev`.

## In production

Build and run the container — it contains no content and syncs your docs repo
at runtime:

```bash
npm run docker:build
docker run -p 4321:4321 \
  -e DOCS_GIT_REPO=https://github.com/your-org/your-docs \
  -e WEBHOOK_SECRET=change-me \
  -v docs-data:/data \
  memoria
```

> [!WARNING]
> Run a single replica. The webhook refreshes one pod's content copy; multiple
> replicas would diverge.

All settings are listed in the [configuration reference](../reference/configuration.md).
