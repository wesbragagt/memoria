// Highlight the current heading in the "On this page" TOC as the reader
// scrolls. The doc page renders <aside class="toc"> with <a href="#id"> links;
// headings carry ids from rehype-slug.

export function initScrollspy(): void {
  const toc = document.querySelector(".toc");
  if (!toc) return;

  const links = Array.from(
    toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
  );
  if (links.length === 0) return;

  const byId = new Map<string, HTMLAnchorElement>();
  const targets: Element[] = [];
  for (const link of links) {
    const id = decodeURIComponent(link.getAttribute("href")!.slice(1));
    const heading = document.getElementById(id);
    if (heading) {
      byId.set(id, link);
      targets.push(heading);
    }
  }
  if (targets.length === 0) return;

  let active: HTMLAnchorElement | null = null;
  const setActive = (link: HTMLAnchorElement | null) => {
    if (link === active) return;
    active?.classList.remove("active");
    active?.removeAttribute("aria-current");
    link?.classList.add("active");
    link?.setAttribute("aria-current", "location");
    active = link;
  };

  // Track which headings are currently intersecting; the topmost visible one
  // (or the last one scrolled past) is "current".
  const visible = new Set<string>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = entry.target.id;
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      // Pick the first heading (in document order) that is visible; if none,
      // fall back to the last heading above the viewport.
      const firstVisible = targets.find((t) => visible.has(t.id));
      if (firstVisible) {
        setActive(byId.get(firstVisible.id) ?? null);
      } else {
        const above = targets.filter(
          (t) => t.getBoundingClientRect().top < 0,
        );
        const last = above[above.length - 1];
        if (last) setActive(byId.get(last.id) ?? null);
      }
    },
    { rootMargin: "0px 0px -70% 0px", threshold: 0 },
  );

  targets.forEach((t) => observer.observe(t));
}
