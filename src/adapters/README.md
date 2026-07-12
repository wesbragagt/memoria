# adapters

Server-only implementations of domain ports. Own all serialization, wire
formats, and technology-specific concerns. Depend on `domain/`, never the
reverse.

Adapters (each behind a "configured?" check so features degrade cleanly
when unconfigured):

- git sync
- query engine client (live-data)
- AI provider (ask-the-docs)
- search index

Secrets are read here, server-side only, and never cross into `client/`.
