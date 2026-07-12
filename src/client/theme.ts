// Theme override wiring for the header toggle. The *initial* theme is applied
// by an inline pre-paint script in Base.astro (see setInitialTheme below,
// which is inlined there as a string) so this module only handles user toggles
// after hydration.
//
// CONTRACT: localStorage["docs.theme"] = "light" | "dark".
//   Absent  → follow OS preference (prefers-color-scheme).
//   Present → explicit override, persisted across visits.

export const THEME_KEY = "docs.theme";

export type Theme = "light" | "dark";

function osTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Currently applied theme, read from the DOM (source of truth after paint). */
function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function apply(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  // Let theme-aware widgets (e.g. mermaid) react without a reload.
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
}

export function initThemeToggle(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (!button) return;

  const sync = () => {
    const theme = currentTheme();
    button.setAttribute("aria-pressed", String(theme === "dark"));
    button.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
    );
    button.dataset.theme = theme;
  };
  sync();

  button.addEventListener("click", () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    apply(next);
    sync();
  });

  // If the user has no explicit override, follow live OS changes.
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (!localStorage.getItem(THEME_KEY)) {
        apply(osTheme());
        sync();
      }
    });
}
