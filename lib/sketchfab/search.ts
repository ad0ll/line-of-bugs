import type { SketchfabHit, SketchfabSearchResponse } from "./types";

interface SearchOpts {
  scientific: string;
  common: string;
  apiKey: string;
  /** override for tests */
  fetchImpl?: typeof fetch;
}

const INSECT_HINTS = new Set([
  "insect","insects","insecta","bug","bugs","beetle","butterfly","moth",
  "bee","wasp","ant","spider","fly","grasshopper","cricket","mantis",
  "ladybug","ladybird","weevil","dragonfly","caterpillar","entomology",
  "arthropod","arthropoda","pollinator","pollinators",
]);

const INSECT_CATEGORY_SLUGS = new Set(["animals-pets", "nature-plants"]);

interface RawSketchfabHit {
  uid: string;
  name: string;
  description?: string;
  user: { username: string; displayName?: string };
  tags: { name: string }[];
  categories: { name: string; slug: string }[];
  thumbnails: { images: { width: number; height: number; url: string }[] };
  viewerUrl: string;
  license?: { slug: string } | null;
}

function isRelevant(hit: RawSketchfabHit, scientific: string, common: string): boolean {
  const text = [
    hit.name,
    hit.description ?? "",
    hit.tags.map(t => t.name).join(" "),
    hit.categories.map(c => c.name).join(" "),
  ].join(" ").toLowerCase();

  const sciToks = scientific.toLowerCase().split(/\s+/);
  const sciFirst = sciToks[0];
  const sciLast = sciToks[sciToks.length - 1];
  if (sciToks.length >= 2 && sciFirst && sciLast && text.includes(sciFirst) && text.includes(sciLast)) {
    return true;
  }
  const com = common.toLowerCase().trim();
  if (com.split(/\s+/).length >= 2 && text.includes(com)) return true;

  const tagSet = new Set(hit.tags.map(t => t.name.toLowerCase()));
  const catSet = new Set(hit.categories.map(c => c.slug));
  const hasInsectSignal =
    [...tagSet].some(t => INSECT_HINTS.has(t)) ||
    [...catSet].some(c => INSECT_CATEGORY_SLUGS.has(c));
  if (com.split(/\s+/).length === 1 && text.includes(com) && hasInsectSignal) return true;

  return false;
}

function pickThumbnail(hit: RawSketchfabHit): string {
  const imgs = hit.thumbnails.images;
  const small = imgs.find(i => i.width === 256);
  if (small) return small.url;
  // fall back to the smallest available
  const sorted = [...imgs].sort((a, b) => a.width - b.width);
  return sorted[0]?.url ?? "";
}

async function runQuery(
  q: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<RawSketchfabHit[]> {
  const url = new URL("https://api.sketchfab.com/v3/search");
  url.searchParams.set("type", "models");
  url.searchParams.set("q", q);
  url.searchParams.set("count", "12");
  // Larger page → enough material to fill a multi-row, scrollable grid
  // even after the strict-relevance filter prunes false positives.
  const r = await fetchImpl(url.toString(), {
    headers: { Authorization: `Token ${apiKey}` },
  });
  if (!r.ok) return [];
  const data = await r.json() as { results?: RawSketchfabHit[] };
  return data.results ?? [];
}

export async function searchSketchfab(opts: SearchOpts): Promise<SketchfabSearchResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const [sciHits, comHits] = await Promise.all([
    runQuery(opts.scientific, opts.apiKey, fetchImpl),
    runQuery(opts.common, opts.apiKey, fetchImpl),
  ]);

  const rawHadResults = sciHits.length > 0 || comHits.length > 0;

  // Build a uid → (hit, matchedBy) map so dedupe preserves which query matched.
  const byUid = new Map<string, { hit: RawSketchfabHit; sci: boolean; com: boolean }>();
  for (const h of sciHits) byUid.set(h.uid, { hit: h, sci: true, com: false });
  for (const h of comHits) {
    const prev = byUid.get(h.uid);
    if (prev) prev.com = true;
    else byUid.set(h.uid, { hit: h, sci: false, com: true });
  }

  const hits: SketchfabHit[] = [];
  for (const { hit, sci, com } of byUid.values()) {
    if (!isRelevant(hit, opts.scientific, opts.common)) continue;
    hits.push({
      uid: hit.uid,
      name: hit.name,
      author: hit.user.displayName ?? hit.user.username,
      authorUsername: hit.user.username,
      thumbnailUrl: pickThumbnail(hit),
      viewerUrl: hit.viewerUrl,
      licenseSlug: hit.license?.slug ?? null,
      matchedBy: sci && com ? "both" : sci ? "scientific" : "common",
    });
  }

  // Stable ordering: scientific matches first, then both, then common.
  const rank = { scientific: 0, both: 1, common: 2 } as const;
  hits.sort((a, b) => rank[a.matchedBy] - rank[b.matchedBy]);

  return { hits, rawHadResults };
}
