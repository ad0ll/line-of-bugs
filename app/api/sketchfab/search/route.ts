import { searchSketchfab } from "@/lib/sketchfab/search";

/**
 * Server-side proxy to Sketchfab's /v3/search endpoint.
 *
 * The Sketchfab API token is server-only — the client UI calls this
 * route and never sees the key. Both `scientific` and `common` are
 * required so the underlying search can run both queries in parallel
 * and rank "matched in both" above single-query hits.
 *
 * Status taxonomy:
 *   400 — caller didn't supply both query params
 *   500 — server is misconfigured (no SKETCHFAB_API_KEY)
 *   502 — Sketchfab itself is unreachable / returned non-2xx
 *   200 — { hits, rawHadResults } (hits may be empty)
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const scientific = url.searchParams.get("scientific");
  const common = url.searchParams.get("common");
  if (!scientific || !common) {
    return new Response(
      JSON.stringify({ error: "scientific and common are both required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const apiKey = process.env.SKETCHFAB_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "SKETCHFAB_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let result;
  try {
    result = await searchSketchfab({ scientific, common, apiKey });
  } catch (e) {
    // searchSketchfab throws on upstream HTTP errors (401 = bad key,
    // 429 = rate limit, 5xx = Sketchfab outage). Surface as 502 so the
    // client UI can distinguish "Sketchfab is broken" from "no results".
    return new Response(
      JSON.stringify({
        error: "upstream search failed",
        detail: e instanceof Error ? e.message : String(e),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // 5 min browser cache, 1 hr CDN cache — Sketchfab content rarely changes
      // within a single session, and even less per species per day.
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
