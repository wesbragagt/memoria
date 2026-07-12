import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";

// One render code path for dev and prod: `output: "server"` renders every
// request at runtime in both modes. The node standalone adapter produces a
// self-contained server (dist/server/entry.mjs) with no serverless lock-in.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    // MDX enables raw-HTML passthrough needed for live-data islands later.
    mdx(),
    // React is used only for the AI chat island; the rest is vanilla JS.
    react(),
  ],
});
