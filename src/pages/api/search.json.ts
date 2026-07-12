// Search endpoint for the ⌘K palette (live results). Fresh search per request.
// Empty/missing q → empty results. Response shape flattens the domain result
// into { slug, title, snippet, matchedIn, url }.
import type { APIRoute } from "astro";
import { searchDocs } from "../../domain/docs";

export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get("q") ?? "").trim();
  const hits = q ? await searchDocs(q) : [];

  const results = hits.map((r) => ({
    slug: r.doc.slug,
    title: r.doc.title,
    snippet: r.snippet,
    matchedIn: r.matchedIn,
    url: `/docs/${r.doc.slug}`,
  }));

  return new Response(JSON.stringify({ query: q, results }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
