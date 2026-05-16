import { getFacetCounts, getUnfilteredFacets } from "@/lib/queries/facets";
import { parseSubject } from "@/lib/subject";

function readList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

/**
 * Faceted-search snapshot.
 *
 * Returns total + every axis's filtered counts in one round-trip.
 * Each axis's counts are computed with every OTHER axis's selection
 * applied and the axis's own selection IGNORED — so multi-select
 * stays orthogonal within an axis (selecting butterflies doesn't
 * zero the cockroach chip).
 *
 * Replaces /api/session/count — the `total` field carries the same
 * pool size that endpoint used to return.
 *
 * When no filters are applied (the SSR initial-render case), we hit
 * the cached unfiltered snapshot which is invalidated by the same
 * `images-stats` tag that admin actions already revalidate.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const subjectType = parseSubject(url.searchParams.get("subject"));
  const views = readList(url.searchParams.get("view"));
  const lifeStages = readList(url.searchParams.get("life"));
  const sexes = readList(url.searchParams.get("sex"));
  const groups = readList(url.searchParams.get("type"));
  const institutions = readList(url.searchParams.get("inst"));
  const q = readList(url.searchParams.get("q"));

  const unfiltered =
    subjectType === "all" &&
    views.length === 0 &&
    lifeStages.length === 0 &&
    sexes.length === 0 &&
    groups.length === 0 &&
    institutions.length === 0 &&
    q.length === 0;

  const snap = unfiltered
    ? await getUnfilteredFacets()
    : await getFacetCounts({
        subjectType,
        views,
        lifeStages,
        sexes,
        groups,
        institutions,
        q,
      });

  return Response.json(snap, {
    headers: {
      // Short shared-cache window — invalidations from admin actions
      // hit `images-stats` immediately, so this only smooths over
      // bursty client polling.
      "Cache-Control": "public, max-age=30, s-maxage=60",
    },
  });
}
