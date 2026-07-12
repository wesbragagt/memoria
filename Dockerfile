# syntax=docker/dockerfile:1
#
# Multi-stage build for the live-SSR docs site.
#
# Invariant: the image ships NO docs content. Docs are cloned from git at
# runtime by src/adapters/git-repo.ts into REPO_DIR (default /data/repo), so
# the final image needs the `git` binary and CA certificates for HTTPS clones.
#
# Native addons: this project has NONE (search is a filesystem scan; no
# better-sqlite3 or other N-API modules), so no build toolchain / rebuild is
# needed in the prod-deps stage.

ARG NODE_VERSION=22

# --- deps: full install for the build ---------------------------------------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- build: astro build -> dist/ ---------------------------------------------
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
RUN npm run build

# --- prod-deps: pruned runtime dependencies ---------------------------------
FROM node:${NODE_VERSION}-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- final: slim runtime ------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS final
# git + CA certs for the runtime clone in src/adapters/git-repo.ts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV REPO_DIR=/data/repo

# Writable data volume for the cloned repo, owned by the non-root user that the
# `node` base image already provides (uid/gid 1000).
RUN mkdir -p /data && chown -R node:node /data

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server.mjs ./

USER node
VOLUME ["/data"]
EXPOSE 4321

# server.mjs disables the adapter autostart and installs graceful-shutdown
# signal handlers around startServer().
CMD ["node", "server.mjs"]
