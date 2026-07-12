# domain

Pure logic, no I/O beyond reading the filesystem. Depends on nothing in
`adapters/`, `render/`, `pages/`, or `client/`.

Responsibilities:

- slug ↔ path resolution
- frontmatter parsing
- title extraction
- doc tree building
- search ranking

Everything here must be unit-testable without a database, network, or a
running server. Adapters implement the ports this layer defines; this layer
never constructs them.
