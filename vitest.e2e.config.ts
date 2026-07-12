import { defineConfig } from "vitest/config";

// E2E suite: drives the BUILT production server (dist/server/entry.mjs via
// server.mjs) over real HTTP. Kept OUT of the default `vitest run` (which stays
// fast + hermetic and needs no build) — run explicitly with `npm run test:e2e`.
//
// Serial: each suite boots a real server child process + does git ops, so we
// disable file parallelism to keep ports/processes predictable and output
// readable. Timeout is generous to cover cold server boot + shallow clones.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests-e2e/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    pool: "forks",
  },
});
