// Client-side reader state persisted in localStorage.
//
// CONTRACT (also consumed by a later recents/favorites-store task and by the
// command palette empty state — keep these shapes stable):
//
//   localStorage["docs.favorites"]
//     JSON array of { slug: string; title: string }
//
//   localStorage["docs.recents"]
//     JSON array of { slug: string; title: string; viewedAt: number }
//     newest-first (index 0 is the most recently viewed).
//
// Every read tolerates missing / malformed data and falls back to []. Writers
// added later must preserve these shapes.

export interface FavoriteEntry {
  slug: string;
  title: string;
}

export interface RecentEntry {
  slug: string;
  title: string;
  viewedAt: number;
}

const FAVORITES_KEY = "docs.favorites";
const RECENTS_KEY = "docs.recents";

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function getFavorites(): FavoriteEntry[] {
  return readArray<FavoriteEntry>(FAVORITES_KEY).filter(
    (e) => e && typeof e.slug === "string" && typeof e.title === "string",
  );
}

export function getRecents(): RecentEntry[] {
  return readArray<RecentEntry>(RECENTS_KEY).filter(
    (e) => e && typeof e.slug === "string" && typeof e.title === "string",
  );
}

export function addRecent(slug: string, title: string): void {
  const recents = getRecents();
  // Remove if already exists (dedupe)
  const filtered = recents.filter((e) => e.slug !== slug);
  // Prepend new entry
  const updated = [
    { slug, title, viewedAt: Date.now() },
    ...filtered,
  ].slice(0, 20); // Cap at ~20
  localStorage.setItem(RECENTS_KEY, JSON.stringify(updated));
}

export function toggleFavorite(slug: string, title: string): boolean {
  const favorites = getFavorites();
  const isFav = favorites.some((e) => e.slug === slug);
  if (isFav) {
    const updated = favorites.filter((e) => e.slug !== slug);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
    return false;
  } else {
    const updated = [...favorites, { slug, title }];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
    return true;
  }
}

export function isFavorite(slug: string): boolean {
  return getFavorites().some((e) => e.slug === slug);
}
