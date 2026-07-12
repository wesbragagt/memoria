import { defineConfig } from "vitest/config";

// Node environment: every test exercises server-side domain/adapter code or
// pure logic. Tests set env vars per-case and point DOCS_DIR/REPO_DIR at temp
// dirs, so they must run serially-safe — each file is isolated by vitest's
// per-file process, and within a file we always restore env in afterEach.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
