import { searchSketchfab } from "@/lib/sketchfab/search";
import { getSpeciesCache } from "@/lib/sketchfab/cache";

/**
 * Server-side proxy to Sketchfab's /v3/search endpoint.
 *
 * The Sketchfab API token is server-only — the client UI calls this
 * route and never sees the key. Both `scientific` and `common` are
 * required so the underlying search can run both queries in parallel
 * and rank "matched in both" above single-query hits.
 *
 * Cache-first policy (added when prod's Hetzner IP was bot-blocked by Akamai):
 *   - Cache row with hits[] populated → return them, never call Sketchfab.
 *   - Cache row with hasModels=false → short-circuit empty.
 *   - Cache row with hasModels=null  → fall through to live call.
 *   - No cache row at all            → fall through to live call.
 *
 * Live calls fail on prod (egress IP blocked). They work locally and
 * cover the "new species added between enrichment runs" gap.
 *
 * Status taxonomy:
 *   400 — caller didn't supply both query params
 *   500 — server is misconfigured (no SKETCHFAB_API_KEY)
 *   502 — Sketchfab itself is unreachable / returned non-2xx
 *   200 — { hits, rawHadResults, precachedHasModels } (hits may be empty)
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

  const cache = getSpeciesCache(scientific);

  // Best case: cache has actual hits → serve them directly. This is the
  // prod path for any species the enrichment job has confirmed.
  if (cache && cache.hits.length > 0) {
    return new Response(
      JSON.stringify({
        hits: cache.hits,
        rawHadResults: true,
        precachedHasModels: true,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300, s-maxage=3600",
        },
      },
    );
  }

  // Cache says "checked, none found" → empty short-circuit. Button greys out.
  if (cache && cache.hasModels === false) {
    return new Response(
      JSON.stringify({ hits: [], rawHadResults: false, precachedHasModels: false }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300, s-maxage=3600",
        },
      },
    );
  }

  // Cache miss (unchecked species) → live call. Will succeed in dev, fail on
  // prod with 502 until the enrichment job catches up.
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
    return new Response(
      JSON.stringify({
        error: "upstream search failed",
        detail: e instanceof Error ? e.message : String(e),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ...result, precachedHasModels: null }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    },
  );
}
