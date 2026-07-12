// Single entry loaded by Base.astro. Wires up all reader-facing chrome once
// the DOM is ready. Everything here is idempotent / safe when its target
// markup is absent (e.g. no TOC on the home page).
import { enhanceCallouts } from "./callouts";
import { enhanceCodeBlocks } from "./code";
import { initMermaid } from "./mermaid";
import { initPalette } from "./palette";
import { initScrollspy } from "./scrollspy";
import { initThemeToggle } from "./theme";
import { initRecentsFavorites } from "./recents-favorites";

function boot(): void {
  initThemeToggle();
  initPalette();
  enhanceCodeBlocks();
  enhanceCallouts();
  initScrollspy();
  void initMermaid(); // dynamic CDN import only if a mermaid block exists
  initRecentsFavorites();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
