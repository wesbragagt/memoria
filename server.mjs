// Production entrypoint with graceful shutdown.
//
// The @astrojs/node standalone adapter auto-starts its HTTP server on import
// and installs NO signal handlers, so a SIGTERM (e.g. Kubernetes pod
// termination) would drop in-flight requests. We disable that autostart via
// ASTRO_NODE_AUTOSTART=disabled, then drive the lifecycle ourselves.
//
// startServer() (from dist/server/entry.mjs) returns { server, done } where
// `server` is the adapter's previewable wrapper:
//   - server.server : the underlying node http.Server
//   - server.stop() : force-destroys all sockets (via `server-destroy`)
//   - server.closed(): promise that resolves on the http 'close' event
//
// Shutdown sequence: stop accepting new connections (http.Server.close),
// let in-flight requests drain, and after SHUTDOWN_GRACE_MS force-destroy any
// stragglers with server.stop(), then exit.
process.env.ASTRO_NODE_AUTOSTART = "disabled";
process.env.HOST = process.env.HOST ?? "0.0.0.0";

const { startServer } = await import("./dist/server/entry.mjs");

const GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 10000);

const { server } = startServer();
const httpServer = server.server;

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, draining (grace ${GRACE_MS}ms)…`);

  // Stop accepting new connections; the callback fires once all in-flight
  // requests have completed and every idle keep-alive socket has closed.
  const drained = new Promise((resolve) => httpServer.close(() => resolve()));

  const timedOut = new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), GRACE_MS).unref();
  });

  const outcome = await Promise.race([drained.then(() => "drained"), timedOut]);

  if (outcome === "timeout") {
    console.log("[server] grace window elapsed, force-closing sockets");
    // server-destroy: closes remaining (keep-alive/slow) sockets.
    await server.stop().catch(() => {});
  }

  console.log("[server] shutdown complete");
  process.exit(0);
}

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => shutdown(sig));
}
