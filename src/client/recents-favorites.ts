// Wire up doc page recents & favorites, and home page list population.
// Idempotent: no-ops cleanly if hooks are absent.

import {
  addRecent,
  toggleFavorite,
  isFavorite,
  getFavorites,
  getRecents,
} from "./store";

export function initRecentsFavorites(): void {
  // Record current doc as recently viewed.
  const docSlug = document.body.getAttribute("data-doc-slug");
  const docTitle = document.body.getAttribute("data-doc-title");
  if (docSlug && docTitle) {
    addRecent(docSlug, docTitle);
  }

  // Wire up favorite button.
  const favBtn = document.getElementById("fav-button");
  if (favBtn && docSlug && docTitle) {
    const updateButton = () => {
      const isFav = isFavorite(docSlug);
      favBtn.setAttribute("aria-pressed", String(isFav));
      favBtn.textContent = isFav ? "★" : "☆";
    };

    updateButton();

    favBtn.addEventListener("click", () => {
      const newState = toggleFavorite(docSlug, docTitle);
      favBtn.setAttribute("aria-pressed", String(newState));
      favBtn.textContent = newState ? "★" : "☆";
    });
  }

  // Populate favorites section on home page.
  const favSection = document.querySelector("[data-favorites]");
  if (favSection) {
    const favorites = getFavorites();
    const emptyMsg = favSection.querySelector("[data-empty]");

    if (favorites.length === 0) {
      if (emptyMsg) (emptyMsg as HTMLElement).style.display = "block";
    } else {
      if (emptyMsg) (emptyMsg as HTMLElement).style.display = "none";
      const ul = document.createElement("ul");
      ul.className = "result-list";
      ul.innerHTML = favorites
        .map(
          (f) =>
            `<li><a href="/docs/${f.slug}" class="result-title">${escapeHtml(f.title)}</a></li>`,
        )
        .join("");
      favSection.appendChild(ul);
    }
  }

  // Populate recents section on home page.
  const recentsSection = document.querySelector("[data-recents]");
  if (recentsSection) {
    const recents = getRecents();
    const emptyMsg = recentsSection.querySelector("[data-empty]");

    if (recents.length === 0) {
      if (emptyMsg) (emptyMsg as HTMLElement).style.display = "block";
    } else {
      if (emptyMsg) (emptyMsg as HTMLElement).style.display = "none";
      const ul = document.createElement("ul");
      ul.className = "result-list";
      ul.innerHTML = recents
        .map(
          (r) =>
            `<li><a href="/docs/${r.slug}" class="result-title">${escapeHtml(r.title)}</a></li>`,
        )
        .join("");
      recentsSection.appendChild(ul);
    }
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
