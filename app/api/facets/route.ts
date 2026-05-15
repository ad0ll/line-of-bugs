import { getFacetCounts } from "@/lib/queries/facets";
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
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const snap = await getFacetCounts({
    subjectType: parseSubject(url.searchParams.get("subject")),
    views: readList(url.searchParams.get("view")),
    lifeStages: readList(url.searchParams.get("life")),
    sexes: readList(url.searchParams.get("sex")),
    groups: readList(url.searchParams.get("type")),
  });
  return Response.json(snap);
}
