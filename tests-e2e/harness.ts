// E2E harness: drive the BUILT production server over real HTTP.
//
// Starts `node server.mjs` (which imports dist/server/entry.mjs) as a child
// process with a caller-supplied env, waits for /healthz to answer 200, and
// stops it cleanly (SIGTERM → wait for exit) so no process is orphaned even on
// test failure. dist/ must already be built — we fail fast with a clear message
// otherwise rather than silently starting a stale/absent server.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = path.join(REPO_ROOT, "dist", "server", "entry.mjs");
const SERVER = path.join(REPO_ROOT, "server.mjs");

// Base port; each suite passes a distinct offset so parallel-safe even though
// the e2e config runs serially.
const BASE_PORT = 43210;

export interface ServerHandle {
  port: number;
  baseUrl: string;
  stop: () => Promise<void>;
}

function assertBuilt(): void {
  if (!existsSync(ENTRY)) {
    throw new Error(
      `Production build missing at ${ENTRY}.\n` +
        `Run \`npm run build\` before \`npm run test:e2e\`.`,
    );
  }
}

async function waitForHealthz(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean };
        if (body.ok === true) return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `Server did not become healthy within ${timeoutMs}ms` +
      (lastErr ? ` (last error: ${String(lastErr)})` : ""),
  );
}

/**
 * Start the built server on BASE_PORT+portOffset with the given extra env.
 * Resolves once /healthz reports ok. The returned stop() sends SIGTERM and
 * resolves when the child exits (force-kill fallback after 8s).
 */
export async function startServer(
  portOffset: number,
  env: Record<string, string>,
  bootTimeoutMs = 30_000,
): Promise<ServerHandle> {
  assertBuilt();
  const port = BASE_PORT + portOffset;
  const baseUrl = `http://127.0.0.1:${port}`;

  const child: ChildProcess = spawn("node", [SERVER], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      SHUTDOWN_GRACE_MS: "2000",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  let exited = false;
  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", () => {
      exited = true;
      resolve();
    });
  });

  const stop = async (): Promise<void> => {
    if (exited) return;
    child.kill("SIGTERM");
    const forced = new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 8_000);
      t.unref();
    });
    await Promise.race([exitPromise, forced]);
  };

  try {
    // If the child dies during boot, surface its logs instead of hanging.
    await Promise.race([
      waitForHealthz(baseUrl, bootTimeoutMs),
      exitPromise.then(() => {
        throw new Error(
          `Server process exited during boot.\n--- server output ---\n${logs.join("")}`,
        );
      }),
    ]);
  } catch (err) {
    await stop();
    throw err;
  }

  return { port, baseUrl, stop };
}
