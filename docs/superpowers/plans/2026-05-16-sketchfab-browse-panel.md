# Sketchfab Browse Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an action-bar button that opens a thumbnail-preview panel of Sketchfab 3D-model search results for the currently-displayed bug; clicking a thumbnail opens the model on Sketchfab in a new tab; the session timer suspends while the panel is open.

**Architecture:** A Next.js Route Handler (`app/api/sketchfab/search/route.ts`) proxies the Sketchfab Data API v3, hiding the API key and running scientific-binomial + common-name queries in parallel (server-side), then unions+dedupes+filters and returns a trimmed JSON payload. A React client component (`SketchfabBrowsePanel`) renders the results in a thumbnail grid above the action bar and pauses the session timer while open. React Query handles fetch/cache; a prefetch effect in `SessionPlayer` warms results for the current bug (and the next one in queue) so the panel opens instantly.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `@tanstack/react-query` 5.x, Drizzle ORM + better-sqlite3, Python 3 for the enrichment cron, Vitest (component + node), Playwright (e2e), pytest (Python).

**Phasing:** Both phases ship together. Phase 1 (T1–T9) is the panel with live API; Phase 2 (T10–T14) adds the `species_metadata.has_sketchfab_models` precache for greyed-out-button UX. They're labeled as phases only to keep dependencies clear during execution (Phase 2 can land tasks while Phase 1 polish is still in flight, but tests across phases should all pass before final commit).

---

## Reference research

- API surface, hit rates, embed/attribution rules, search strategy comparison: `docs/sketchfab_api_probe.md`
- Probe scripts (kept for re-runs): `tools/sketchfab_probe.py`, `tools/sketchfab_big_probe.py`
- Sketchfab Developer Terms §4.7 (attribution requirements for download API; weaker for display-only)
- Existing deferred-feature notes: `docs/sketchfab-notes.md`

## Design system mapping (CLAUDE.md + docs/design-system.md)

The panel is **chrome, not product** (the bug photo is product). Per the design system:

- **Accent role:** This is browsing/external content. Use `--accent-lilac` for the panel border + heading underline (structure role) and `--accent-sky` for per-card hover/external-link affordance (matches the existing `source ↗` pattern). **Never `--accent-pink`** — that's reserved for primary actions.
- **Surface:** `--surface-1` background, `--r-4xl` corners to match the action-bar panel, `--shadow-panel`, `backdrop-filter: blur(...)` via the existing `u-backdrop-blur-md` utility.
- **Typography:**
  - Panel heading: Fraunces italic, 14px
  - Model titles: Zen Maru Gothic, 13px, 2-line truncate with `-webkit-line-clamp: 2`
  - Author username chip: JetBrains Mono, 11px
  - "Powered by Sketchfab" badge: JetBrains Mono, 11px, `--surface-chip-strong`
- **Spacing:** 4px grid via `--s*` tokens. No magic pixels.
- **Animation:** Slide-up + scale-in over 180ms, ease-out. `transform-origin: bottom right` (aligned to where the Sketchfab IconBtn sits in the action bar). GPU-only (`transform` + `opacity`); never animate `height` or `top`.
- **Auto-hide bypass:** While the panel is open, suppress the action-bar 2s-idle auto-hide. The panel itself dismisses on Escape, outside click, or trigger re-click.

## Performance strategy

| Risk | Mitigation |
|---|---|
| Cold ~400ms API round-trip on first click | **Prefetch on bug image-load** via `queryClient.prefetchQuery`. Panel-open becomes instant. |
| Repeated cold fetches when navigating bugs | **N+1 lookahead** — prefetch the *next* bug's results too. |
| Wasted fetch on species with zero models (~½ corpus) | **Phase 2:** read `species_metadata.has_sketchfab_models`; if false, grey the button and skip the fetch. |
| Thumbnail bytes | Use the **256×144 tier** (~5KB jpeg). Six thumbs ≈ 30KB total. |
| Layout shift as images load | `width` + `height` attrs on `<img>`; aspect-ratio 16:9 box. |
| Main-thread JPEG decode | `decoding="async"` on every `<img>`. |
| Stale fetch finishing after panel close | Pass `signal` from React Query into `fetch` — already canceled by React Query on unmount. |
| Animation jank | `transform` + `opacity` only; `will-change: transform` during animation; remove `will-change` after. |
| Multiple WebGL contexts (if ever inline-embedded) | **Out of scope for Phase 1.** Thumbnails only; click opens Sketchfab in a new tab. |

## Attribution

Per Sketchfab Developer ToS, for **display-only** use (thumbnails + link out, no download/redistribution), the legal floor is low. We still do the right thing:

- Each card shows the model author (`user.displayName` if present, else `user.username`) as a mono chip.
- A small "Powered by Sketchfab" badge sits in the panel header.
- Clicking the thumbnail opens the canonical Sketchfab model page (`viewerUrl`) in a new tab.
- License (`license.slug`) is surfaced via a tooltip on the author chip — not legally required for display but useful for students who want to reuse.

## File structure

**Phase 1 (new):**
- `lib/sketchfab/search.ts` — Server-only API client: parallel binomial+common queries, dedupe, relevance filter, trimming.
- `lib/sketchfab/types.ts` — `SketchfabHit` + response shape, shared client+server.
- `app/api/sketchfab/search/route.ts` — Route Handler proxy. Reads `SKETCHFAB_API_KEY` from env, never exposes it.
- `app/components/session/SketchfabBrowsePanel.tsx` — Client component rendering loading/results/empty/error states.
- `tests/lib/sketchfab-search.test.ts` — Unit tests for the client module (mocked fetch).
- `tests/components/SketchfabBrowsePanel.test.tsx` — Component tests for the four render states.
- `tests/e2e/sketchfab-panel.spec.ts` — Playwright happy-path.

**Phase 1 (modify):**
- `app/components/session/SessionActionBar.tsx` — Add a new Sketchfab `IconBtn`; new props for `sketchfabOpen` + `onToggleSketchfab`.
- `app/components/session/SessionPlayer.tsx` — Add `sketchfabOpen` state; include it in `useHighResTimer`'s `active` predicate; wire `<SketchfabBrowsePanel>` into the render tree; add prefetch effects.
- `app/globals.css` — Add `.sketchfab-panel*` styles, append at the end of the file's component section.
- `tests/components/SessionActionBar.test.tsx` — Update assertions to cover the new button.

**Phase 2 (new):**
- `drizzle/0011_species_metadata.sql` — Table migration.
- `scripts/sketchfab_enrichment.py` — Cron-style script populating `species_metadata.has_sketchfab_models`.
- `tests/python/test_sketchfab_enrichment.py` — Unit tests with mocked requests.

**Phase 2 (modify):**
- `db/schema.ts` — Add `species_metadata` table + types.
- `drizzle/meta/_journal.json` — Append migration entry.
- `lib/sketchfab/search.ts` — Add `hasModelsForSpecies()` query against `species_metadata`.
- `app/api/sketchfab/search/route.ts` — Short-circuit with `{has_models: false, results: []}` when precache says false.
- `app/components/session/SketchfabBrowsePanel.tsx` — Pass `disabled` through to the trigger button.

---

# Phase 1 — Ship the panel (live API)

## Task 1: Sketchfab API client module

**Files:**
- Create: `lib/sketchfab/types.ts`
- Create: `lib/sketchfab/search.ts`
- Test: `tests/lib/sketchfab-search.test.ts`

**Why this is a separate module:** The route handler should stay thin (parse query, return JSON). All Sketchfab-specific logic — parallel queries, dedupe, relevance scoring, response trimming — lives here so it's testable in isolation against a mocked `fetch`.

- [ ] **Step 1: Create the shared types file**

```typescript
// lib/sketchfab/types.ts
/**
 * Trimmed shape returned by /api/sketchfab/search.
 * Only fields the panel UI consumes — keeps the wire payload small
 * and decouples the client from Sketchfab's full model record.
 */
export interface SketchfabHit {
  uid: string;
  name: string;
  author: string;          // user.displayName ?? user.username
  authorUsername: string;  // for the @handle chip
  thumbnailUrl: string;    // 256x144 tier
  viewerUrl: string;       // canonical Sketchfab page (click target)
  licenseSlug: string | null;
  matchedBy: "scientific" | "common" | "both";
}

export interface SketchfabSearchResponse {
  hits: SketchfabHit[];
  /** Set true if either query returned ≥1 hit BEFORE relevance filtering.
   *  Lets the UI distinguish "Sketchfab has nothing" from "we filtered everything out". */
  rawHadResults: boolean;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/lib/sketchfab-search.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSketchfab } from "@/lib/sketchfab/search";

const sciHit = {
  uid: "sci123",
  name: "Apis mellifera - CT Scan",
  description: "Apis mellifera, museum specimen",
  user: { username: "etainproject", displayName: "ETAIN" },
  tags: [{ name: "insect" }, { name: "bee" }],
  categories: [{ name: "Animals & Pets", slug: "animals-pets" }],
  thumbnails: { images: [
    { width: 256, height: 144, url: "https://media.sketchfab.com/thumb-256.jpg" },
    { width: 1024, height: 576, url: "https://media.sketchfab.com/thumb-1024.jpg" },
  ]},
  viewerUrl: "https://sketchfab.com/3d-models/apis-mellifera-sci123",
  license: { slug: "by" },
};

const comHit = {
  uid: "com456",
  name: "Honey Bee model",
  description: "low-poly honey bee",
  user: { username: "modeler", displayName: "Modeler" },
  tags: [{ name: "bee" }],
  categories: [{ name: "Animals & Pets", slug: "animals-pets" }],
  thumbnails: { images: [
    { width: 256, height: 144, url: "https://media.sketchfab.com/com-256.jpg" },
  ]},
  viewerUrl: "https://sketchfab.com/3d-models/honey-bee-com456",
  license: { slug: "by-nc" },
};

describe("searchSketchfab", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("merges parallel sci + common results and dedupes by uid", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      const q = u.searchParams.get("q");
      const results = q === "Apis mellifera" ? [sciHit, comHit] : [comHit];
      return new Response(JSON.stringify({ results }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await searchSketchfab({
      scientific: "Apis mellifera", common: "honey bee", apiKey: "k",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.hits.map(h => h.uid).sort()).toEqual(["com456", "sci123"]);
    expect(out.hits.find(h => h.uid === "sci123")?.matchedBy).toBe("scientific");
    expect(out.hits.find(h => h.uid === "com456")?.matchedBy).toBe("both");
    expect(out.rawHadResults).toBe(true);
  });

  it("returns empty hits + rawHadResults=false when both queries miss", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 })
    ));
    const out = await searchSketchfab({
      scientific: "Nonexistus speciosus", common: "fake bug", apiKey: "k",
    });
    expect(out.hits).toEqual([]);
    expect(out.rawHadResults).toBe(false);
  });

  it("drops fuzzy username-only matches (no insect signal)", async () => {
    const noise = {
      ...sciHit, uid: "noise", name: "Bread",
      description: "bread model",
      tags: [{ name: "food" }],
      categories: [{ name: "Food & Drink", slug: "food-drink" }],
      user: { username: "vanessa3d", displayName: "Vanessa3D" },
    };
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ results: [noise] }), { status: 200 })
    ));
    const out = await searchSketchfab({
      scientific: "Vanessa itea", common: "Yellow Admiral", apiKey: "k",
    });
    expect(out.hits).toEqual([]);
    expect(out.rawHadResults).toBe(true); // had raw results but filtered out
  });

  it("picks the 256x144 thumbnail, not the largest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ results: [sciHit] }), { status: 200 })
    ));
    const out = await searchSketchfab({
      scientific: "Apis mellifera", common: "honey bee", apiKey: "k",
    });
    expect(out.hits[0].thumbnailUrl).toBe("https://media.sketchfab.com/thumb-256.jpg");
  });
});
```

- [ ] **Step 3: Run the test (must fail with module-not-found)**

Run: `npm run test -- tests/lib/sketchfab-search.test.ts`
Expected: FAIL — `Cannot find module '@/lib/sketchfab/search'`.

- [ ] **Step 4: Implement the client module**

```typescript
// lib/sketchfab/search.ts
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
  if (sciToks.length >= 2 && text.includes(sciToks[0]) && text.includes(sciToks[sciToks.length - 1])) {
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
```

- [ ] **Step 5: Run tests — must pass**

Run: `npm run test -- tests/lib/sketchfab-search.test.ts`
Expected: PASS — all four assertions green.

- [ ] **Step 6: Commit**

```bash
git add lib/sketchfab/types.ts lib/sketchfab/search.ts tests/lib/sketchfab-search.test.ts
git commit --no-gpg-sign -m "feat(sketchfab): server-side search client w/ relevance filter

$(cat <<'EOF'
Parallel binomial + common queries against Sketchfab Data API v3,
dedupes by uid, drops fuzzy username-only matches, trims response
to fields the panel UI consumes. Picks 256x144 thumbnail for grid.
EOF
)"
```

---

## Task 2: API route handler

**Files:**
- Create: `app/api/sketchfab/search/route.ts`
- Test: `tests/api/sketchfab-search-route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/sketchfab-search-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sketchfab/search", () => ({
  searchSketchfab: vi.fn(),
}));

import { GET } from "@/app/api/sketchfab/search/route";
import { searchSketchfab } from "@/lib/sketchfab/search";

describe("GET /api/sketchfab/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SKETCHFAB_API_KEY = "test-key";
  });

  it("400s when scientific OR common is missing", async () => {
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=Apis"));
    expect(r.status).toBe(400);
  });

  it("500s when SKETCHFAB_API_KEY is missing", async () => {
    delete process.env.SKETCHFAB_API_KEY;
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=Apis&common=bee"));
    expect(r.status).toBe(500);
  });

  it("calls searchSketchfab with parsed params + returns JSON", async () => {
    (searchSketchfab as ReturnType<typeof vi.fn>).mockResolvedValue({
      hits: [{ uid: "u1", name: "Bee", author: "x", authorUsername: "x",
               thumbnailUrl: "https://t", viewerUrl: "https://v",
               licenseSlug: "by", matchedBy: "scientific" }],
      rawHadResults: true,
    });
    const r = await GET(new Request(
      "http://x/api/sketchfab/search?scientific=Apis%20mellifera&common=honey%20bee"
    ));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0].uid).toBe("u1");
    expect(searchSketchfab).toHaveBeenCalledWith({
      scientific: "Apis mellifera",
      common: "honey bee",
      apiKey: "test-key",
    });
  });

  it("sets a short s-maxage cache header so the CDN can hold it briefly", async () => {
    (searchSketchfab as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: [], rawHadResults: false });
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=A&common=b"));
    expect(r.headers.get("Cache-Control")).toMatch(/s-maxage=\d+/);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm run test -- tests/api/sketchfab-search-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/sketchfab/search/route'`.

- [ ] **Step 3: Implement the route**

```typescript
// app/api/sketchfab/search/route.ts
import { searchSketchfab } from "@/lib/sketchfab/search";

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

  const result = await searchSketchfab({ scientific, common, apiKey });
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
```

- [ ] **Step 4: Run — must pass**

Run: `npm run test -- tests/api/sketchfab-search-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Smoke-test against live API**

Run: `npm run dev` in one terminal; in another:
```bash
curl -s "http://localhost:3000/api/sketchfab/search?scientific=Apis%20mellifera&common=Western%20Honey%20Bee" | python3 -m json.tool | head -30
```
Expected: JSON with `hits[]` containing ≥1 hit whose `matchedBy` is `scientific` or `both`.

- [ ] **Step 6: Commit**

```bash
git add app/api/sketchfab/search/route.ts tests/api/sketchfab-search-route.test.ts
git commit --no-gpg-sign -m "feat(sketchfab): /api/sketchfab/search route handler"
```

---

## Task 3: SketchfabBrowsePanel component

**Files:**
- Create: `app/components/session/SketchfabBrowsePanel.tsx`
- Test: `tests/components/SketchfabBrowsePanel.test.tsx`

Renders four states: **loading** (skeleton tiles), **results** (thumbnail grid), **empty** ("no models" + manual-search link), **error** (one-line fallback). Card click is a plain anchor with `target="_blank"`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/SketchfabBrowsePanel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SketchfabBrowsePanel } from "@/app/components/session/SketchfabBrowsePanel";

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const hit = {
  uid: "u1", name: "Apis mellifera CT", author: "ETAIN", authorUsername: "etain",
  thumbnailUrl: "https://media.sketchfab.com/thumb-256.jpg",
  viewerUrl: "https://sketchfab.com/3d-models/u1",
  licenseSlug: "by", matchedBy: "scientific" as const,
};

describe("SketchfabBrowsePanel", () => {
  it("shows loading skeletons before data arrives", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {})); // never resolves
    wrap(<SketchfabBrowsePanel scientific="Apis mellifera" common="honey bee" open onClose={() => {}} />);
    // 3 skeleton placeholders by default
    expect(screen.getAllByTestId("sketchfab-skeleton")).toHaveLength(3);
  });

  it("renders thumbnails when results arrive", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ hits: [hit], rawHadResults: true })));
    wrap(<SketchfabBrowsePanel scientific="Apis mellifera" common="honey bee" open onClose={() => {}} />);
    const link = await screen.findByRole("link", { name: /Apis mellifera CT/i });
    expect(link).toHaveAttribute("href", hit.viewerUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText("@etain")).toBeInTheDocument();
  });

  it("renders the empty state when there are no hits", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ hits: [], rawHadResults: false })));
    wrap(<SketchfabBrowsePanel scientific="X" common="y" open onClose={() => {}} />);
    expect(await screen.findByText(/no 3d models/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /search sketchfab anyway/i }))
      .toHaveAttribute("href", expect.stringContaining("sketchfab.com/search"));
  });

  it("returns null and fires no fetch when open=false", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = wrap(
      <SketchfabBrowsePanel scientific="X" common="y" open={false} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm run test -- tests/components/SketchfabBrowsePanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// app/components/session/SketchfabBrowsePanel.tsx
"use client";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SketchfabHit, SketchfabSearchResponse } from "@/lib/sketchfab/types";

interface Props {
  scientific: string;
  common: string;
  open: boolean;
  onClose: () => void;
}

async function fetchSketchfab(
  scientific: string,
  common: string,
  signal: AbortSignal,
): Promise<SketchfabSearchResponse> {
  const u = new URL("/api/sketchfab/search", window.location.origin);
  u.searchParams.set("scientific", scientific);
  u.searchParams.set("common", common);
  const r = await fetch(u.toString(), { signal });
  if (!r.ok) throw new Error(`sketchfab search failed: ${r.status}`);
  return r.json();
}

export function sketchfabQueryKey(scientific: string, common: string) {
  return ["sketchfab", scientific, common] as const;
}

export function SketchfabBrowsePanel({ scientific, common, open, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Escape + outside-click dismiss
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  const { data, isPending, isError } = useQuery({
    queryKey: sketchfabQueryKey(scientific, common),
    queryFn: ({ signal }) => fetchSketchfab(scientific, common, signal),
    enabled: open && !!scientific && !!common,
    staleTime: 10 * 60_000,
  });

  if (!open) return null;

  const manualSearchUrl =
    `https://sketchfab.com/search?type=models&q=${encodeURIComponent(common || scientific)}`;

  return (
    <div ref={ref} className="sketchfab-panel u-backdrop-blur-md" role="dialog" aria-label="Sketchfab models">
      <header className="sketchfab-panel-header">
        <span className="sketchfab-panel-title">Sketchfab models</span>
        <span className="sketchfab-panel-source">Powered by Sketchfab</span>
        <button
          type="button"
          className="sketchfab-panel-close"
          aria-label="Close Sketchfab panel"
          onClick={onClose}
        >×</button>
      </header>

      {isPending && (
        <div className="sketchfab-panel-grid" aria-busy="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="sketchfab-card-skeleton" data-testid="sketchfab-skeleton" />
          ))}
        </div>
      )}

      {!isPending && isError && (
        <div className="sketchfab-panel-empty">
          <p>Couldn’t reach Sketchfab right now.</p>
          <a className="sketchfab-empty-link" href={manualSearchUrl} target="_blank" rel="noopener noreferrer">
            Search Sketchfab in a new tab ↗
          </a>
        </div>
      )}

      {!isPending && !isError && data && data.hits.length === 0 && (
        <div className="sketchfab-panel-empty">
          <p>No 3D models found for this species.</p>
          <a className="sketchfab-empty-link" href={manualSearchUrl} target="_blank" rel="noopener noreferrer">
            Search Sketchfab anyway ↗
          </a>
        </div>
      )}

      {!isPending && !isError && data && data.hits.length > 0 && (
        <ul className="sketchfab-panel-grid">
          {data.hits.map((h: SketchfabHit) => (
            <li key={h.uid} className="sketchfab-card">
              <a
                className="sketchfab-card-link"
                href={h.viewerUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  className="sketchfab-card-thumb"
                  src={h.thumbnailUrl}
                  alt={h.name}
                  width={256}
                  height={144}
                  loading="eager"
                  decoding="async"
                />
                <span className="sketchfab-card-title">{h.name}</span>
                <span
                  className="sketchfab-card-author"
                  title={h.licenseSlug ? `License: ${h.licenseSlug.toUpperCase()}` : undefined}
                >@{h.authorUsername}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm run test -- tests/components/SketchfabBrowsePanel.test.tsx`
Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
git add app/components/session/SketchfabBrowsePanel.tsx tests/components/SketchfabBrowsePanel.test.tsx
git commit --no-gpg-sign -m "feat(sketchfab): browse panel component (loading/results/empty/error)"
```

---

## Task 4: Panel styles

**Files:**
- Modify: `app/globals.css` (append a new section at the end of the component section)

- [ ] **Step 1: Append the styles**

Add at the end of the component section of `app/globals.css` (find the last `.session-action-bar-*` rule and insert below):

```css
/* ───────────────── Sketchfab browse panel ───────────────── */

.sketchfab-panel {
  position: fixed;
  /* Anchored above the action bar. The action bar wrap uses
     bottom: 0 + padding-bottom (~var(--s8)+2px) + ~52px tile height,
     so we clear ~80px to sit above it with a small gap. */
  bottom: calc(var(--s24) + var(--s12));
  right: var(--s10);
  left: var(--s10);
  max-width: 720px;
  margin-inline: auto;
  display: flex;
  flex-direction: column;
  gap: var(--s3);
  padding: var(--s4);
  background: var(--surface-1);
  border: 1px solid var(--accent-lilac);
  border-radius: var(--r-4xl);
  box-shadow: var(--shadow-panel);
  z-index: 31; /* one above the action bar */
  transform-origin: bottom right;
  animation: sketchfab-panel-in var(--timing-base) ease-out;
}

@keyframes sketchfab-panel-in {
  from { opacity: 0; transform: translateY(8px) scaleY(0.92); }
  to   { opacity: 1; transform: translateY(0) scaleY(1); }
}

.sketchfab-panel-header {
  display: flex;
  align-items: baseline;
  gap: var(--s3);
  padding: 0 var(--s2);
}

.sketchfab-panel-title {
  font-family: var(--font-fraunces);
  font-style: italic;
  font-size: var(--text-md);
  color: var(--text-primary);
  flex: 1;
}

.sketchfab-panel-source {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: var(--surface-chip-strong);
  padding: var(--s1) var(--s2);
  border-radius: var(--r-pill);
}

.sketchfab-panel-close {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: var(--text-lg);
  cursor: pointer;
  padding: 0 var(--s2);
  line-height: 1;
}
.sketchfab-panel-close:hover { color: var(--accent-pink); }

.sketchfab-panel-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--s3);
  list-style: none;
  padding: 0;
  margin: 0;
  /* Multi-row scroll: ~2.5 rows of 16:9 cards visible at a time so the
     "more below" cue is implicit. Tune via /audit (see step 2 below). */
  max-height: 56vh;
  overflow-y: auto;
  /* Avoid layout shift when scrollbar appears */
  scrollbar-gutter: stable;
}

/* Tablet: 2 cols, taller scroll region */
@media (max-width: 720px) {
  .sketchfab-panel-grid {
    grid-template-columns: repeat(2, 1fr);
    max-height: 50vh;
  }
}

/* Phone: single column, smaller cap so the action bar stays in view */
@media (max-width: 420px) {
  .sketchfab-panel {
    /* Panel itself hugs the viewport edges on phone */
    left: var(--s3);
    right: var(--s3);
  }
  .sketchfab-panel-grid {
    grid-template-columns: 1fr;
    max-height: 44vh;
  }
}

.sketchfab-card { display: flex; }

.sketchfab-card-link {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  background: var(--surface-2);
  border: 1px solid transparent;
  border-radius: var(--r-lg);
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition:
    transform var(--timing-fast),
    border-color var(--timing-fast);
  min-height: 44px; /* touch target */
}
.sketchfab-card-link:hover,
.sketchfab-card-link:focus-visible {
  transform: translateY(-2px);
  border-color: var(--accent-sky);
  outline: none;
}

.sketchfab-card-thumb {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  background: var(--surface-0);
}

.sketchfab-card-title {
  font-family: var(--font-zen-maru);
  font-size: var(--text-sm);
  color: var(--text-primary);
  padding: var(--s2) var(--s2) 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.sketchfab-card-author {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding: 0 var(--s2) var(--s2);
}

.sketchfab-card-skeleton {
  aspect-ratio: 16 / 9;
  background: linear-gradient(
    90deg,
    var(--surface-2) 0%,
    var(--surface-1) 50%,
    var(--surface-2) 100%
  );
  background-size: 200% 100%;
  border-radius: var(--r-lg);
  animation: sketchfab-shimmer 1.4s ease-in-out infinite;
}

@keyframes sketchfab-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.sketchfab-panel-empty {
  padding: var(--s4);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: var(--s2);
  align-items: center;
}
.sketchfab-panel-empty p {
  font-family: var(--font-zen-maru);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin: 0;
}
.sketchfab-empty-link {
  color: var(--accent-sky);
  text-decoration: none;
  font-size: var(--text-sm);
}
.sketchfab-empty-link:hover { text-decoration: underline; }

@media (prefers-reduced-motion: reduce) {
  .sketchfab-panel { animation: none; }
  .sketchfab-card-skeleton { animation: none; }
  .sketchfab-card-link:hover { transform: none; }
}
```

- [ ] **Step 2: Visual smoke check with 12+ cards**

CSS-only change; verify with a temporary harness. Open `npm run dev`, navigate to any page, and in the browser DevTools console paste:

```js
document.body.insertAdjacentHTML("beforeend", `
<div class="sketchfab-panel u-backdrop-blur-md" style="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);max-width:720px;width:90%">
  <div class="sketchfab-panel-header">
    <span class="sketchfab-panel-title">Sketchfab models</span>
    <span class="sketchfab-panel-source">Powered by Sketchfab</span>
    <button class="sketchfab-panel-close">×</button>
  </div>
  <ul class="sketchfab-panel-grid">
    ${Array.from({length:12}).map((_,i) => \`
      <li class="sketchfab-card">
        <a class="sketchfab-card-link">
          <div class="sketchfab-card-thumb" style="background:hsl(\${i*30},20%,30%)"></div>
          <span class="sketchfab-card-title">Sample model #\${i+1} with a name long enough to clamp to two lines</span>
          <span class="sketchfab-card-author">@author\${i}</span>
        </a>
      </li>\`).join("")}
  </ul>
</div>`);
```

Verify:
- Desktop ≥720px: 3 cols, ~2.5 rows visible, scroll reveals the rest
- Tablet 420–720px: 2 cols, ~2.5 rows visible
- Phone <420px: 1 col, panel hugs viewport edges
- Hover lifts cards with sky-colored border
- Titles clamp to 2 lines
- Scrollbar appears without layout shift

Resize the window through each breakpoint. Remove the test markup before continuing.

- [ ] **Step 3: Run /audit on the panel aesthetics**

Use the `audit` skill to evaluate the rendered panel against the design system. The user expects this — they explicitly want the visual tuned (result count visible, grid density, scroll cue, mobile layout) rather than locked in by the planner's defaults.

Invoke: call the `Skill` tool with `skill: "audit"` and arg describing the target ("session/SketchfabBrowsePanel + .sketchfab-panel-* styles in globals.css").

Apply any audit-recommended adjustments (gap/padding/breakpoints/card height/result-cap visible rows) by editing `app/globals.css`. The visible-cards count should land at 4–5 across breakpoints per the user's direction; tune via `max-height` on `.sketchfab-panel-grid` per breakpoint.

If `/audit` recommends component-level changes (e.g., showing fewer cards initially with a "show more"), open a follow-up sub-task — do not silently expand scope here.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit --no-gpg-sign -m "feat(sketchfab): panel + card styles using design system tokens

$(cat <<'EOF'
- 3-col desktop / 2-col tablet / 1-col phone
- Scrollable grid with ~2.5 rows visible (cap tuned via /audit)
- Sky-colored hover border (external-link affordance per design system)
- Shimmer skeletons + reduced-motion fallback
EOF
)"
```

---

## Task 5: Action-bar integration

**Files:**
- Modify: `app/components/session/SessionActionBar.tsx`
- Modify: `tests/components/SessionActionBar.test.tsx`

- [ ] **Step 1: Update the SessionActionBar test first**

Open `tests/components/SessionActionBar.test.tsx` and add this test alongside existing ones:

```tsx
it("renders a Sketchfab toggle button reflecting active state", () => {
  const onToggle = vi.fn();
  render(<SessionActionBar
    {...baseProps}
    sketchfabOpen={false}
    onToggleSketchfab={onToggle}
  />);
  const btn = screen.getByRole("button", { name: /sketchfab/i });
  expect(btn).not.toHaveClass("is-active");
  fireEvent.click(btn);
  expect(onToggle).toHaveBeenCalledTimes(1);
});

it("marks the Sketchfab button active when panel is open", () => {
  render(<SessionActionBar
    {...baseProps}
    sketchfabOpen={true}
    onToggleSketchfab={() => {}}
  />);
  expect(screen.getByRole("button", { name: /sketchfab/i })).toHaveClass("is-active");
});
```

(If `baseProps` doesn't yet exist in that file, factor existing test setup into a `baseProps` const at the top of the describe block, omitting `sketchfabOpen`/`onToggleSketchfab`.)

- [ ] **Step 2: Run — must fail**

Run: `npm run test -- tests/components/SessionActionBar.test.tsx`
Expected: FAIL — "sketchfab" button not found / props don't exist.

- [ ] **Step 3: Add the props + button to SessionActionBar**

Edit `app/components/session/SessionActionBar.tsx`:

Add to the `Props` interface (alphabetically with the other on* handlers):
```tsx
  sketchfabOpen: boolean;
  onToggleSketchfab: () => void;
```

Add the IconBtn between the report button and the source link (so order is: pause / interval / b.w / magnifier / fullscreen / **sketchfab** / report / source / counter):

```tsx
<IconBtn
  label="sketchfab"
  hint="K"
  active={props.sketchfabOpen}
  onClick={props.onToggleSketchfab}
>
  ▦
</IconBtn>
```

- [ ] **Step 4: Run — must pass**

Run: `npm run test -- tests/components/SessionActionBar.test.tsx`
Expected: PASS — both new tests + all existing tests green.

- [ ] **Step 5: Commit**

```bash
git add app/components/session/SessionActionBar.tsx tests/components/SessionActionBar.test.tsx
git commit --no-gpg-sign -m "feat(sketchfab): action-bar Sketchfab toggle button + tests"
```

---

## Task 6: Wire panel + timer pause into SessionPlayer

**Files:**
- Modify: `app/components/session/SessionPlayer.tsx`

This task does three things atomically: adds `sketchfabOpen` state, wires it to the timer's `active` predicate, and mounts `<SketchfabBrowsePanel>` next to the action bar.

- [ ] **Step 1: Add the state + timer predicate**

Find the `useState` block (around line 30) and add:
```tsx
const [sketchfabOpen, setSketchfabOpen] = useState(false);
```

Find the `useHighResTimer` call (around line 145) and change the `active` argument from:
```tsx
!paused && !done && !reportModalOpen,
```
to:
```tsx
!paused && !done && !reportModalOpen && !sketchfabOpen,
```

- [ ] **Step 2: Wire the panel + toggle**

Import at the top:
```tsx
import { SketchfabBrowsePanel } from "./SketchfabBrowsePanel";
```

In the JSX, pass the new props to `<SessionActionBar>`:
```tsx
sketchfabOpen={sketchfabOpen}
onToggleSketchfab={() => setSketchfabOpen(o => !o)}
```

Mount the panel next to the action bar (just before or after the `<SessionActionBar>` element):
```tsx
<SketchfabBrowsePanel
  scientific={current.taxonSpecies ?? ""}
  common={current.commonName ?? ""}
  open={sketchfabOpen && !!current.taxonSpecies && !!current.commonName}
  onClose={() => setSketchfabOpen(false)}
/>
```

(Adjust property access — `current.taxonSpecies`, `current.commonName` — to match whatever the component uses for the active image; check the existing `bug name top-left chip` render path in this file for the correct path.)

- [ ] **Step 3: Add keyboard shortcut (K)**

Find the existing key handler `useEffect` (look for the `"space"` handler that toggles pause). Add a case:
```tsx
if (e.key.toLowerCase() === "k") {
  e.preventDefault();
  setSketchfabOpen(o => !o);
  return;
}
```

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`, open a session, click the new ▦ button. Verify:
- Panel appears above action bar with skeletons → results
- Timer pauses (the elapsed display freezes; progress bar stops advancing)
- Pressing Escape closes the panel, timer resumes
- Pressing K toggles the panel
- Clicking a thumbnail opens Sketchfab in a new tab
- Returning to the session: timer is still paused (because panel was closed, but we closed via thumbnail click — verify by closing panel first, returning, then resuming with Space or Pause button)

If anything fails, fix and re-test before committing.

- [ ] **Step 5: Commit**

```bash
git add app/components/session/SessionPlayer.tsx
git commit --no-gpg-sign -m "feat(sketchfab): mount panel + suspend timer while open

$(cat <<'EOF'
Adds sketchfabOpen state; includes it in useHighResTimer's active
predicate so the timer pauses identically to report-modal pause.
K keyboard shortcut + Escape/outside-click dismiss inherited from
the panel component.
EOF
)"
```

---

## Task 7: Prefetch on bug image-load

**Files:**
- Modify: `app/components/session/SessionPlayer.tsx`

Eliminates first-click latency by warming the React Query cache as soon as the bug image is rendered.

- [ ] **Step 1: Add the prefetch effect**

At the top of `SessionPlayer.tsx`, import:
```tsx
import { useQueryClient } from "@tanstack/react-query";
import { sketchfabQueryKey } from "./SketchfabBrowsePanel";
```

Inside the component, add (alongside other `useEffect`s):
```tsx
const qc = useQueryClient();

useEffect(() => {
  const sci = current.taxonSpecies;
  const com = current.commonName;
  if (!sci || !com) return;
  // Fire-and-forget; React Query dedupes if the panel later opens with
  // the same key. We use `prefetchQuery` so the result is cached but
  // does not subscribe — no re-renders if it succeeds.
  void qc.prefetchQuery({
    queryKey: sketchfabQueryKey(sci, com),
    queryFn: async ({ signal }) => {
      const u = new URL("/api/sketchfab/search", window.location.origin);
      u.searchParams.set("scientific", sci);
      u.searchParams.set("common", com);
      const r = await fetch(u.toString(), { signal });
      if (!r.ok) throw new Error("prefetch failed");
      return r.json();
    },
    staleTime: 10 * 60_000,
  });
}, [current.taxonSpecies, current.commonName, qc]);
```

(Extract the inline `queryFn` into a shared `fetchSketchfab` helper in `SketchfabBrowsePanel.tsx` if you prefer; the panel's own query uses the same shape.)

- [ ] **Step 2: Manual verification**

Run: `npm run dev`. Open a session, wait a moment for the prefetch to fire (~400ms), then click ▦.
Expected: panel opens with results already populated — no skeleton flash.

Check Network tab: there should be **one** `/api/sketchfab/search` request per species, not two (the panel's `useQuery` reuses the prefetched cache entry).

- [ ] **Step 3: Commit**

```bash
git add app/components/session/SessionPlayer.tsx
git commit --no-gpg-sign -m "perf(sketchfab): prefetch results on bug image-load"
```

---

## Task 8: N+1 lookahead prefetch

**Files:**
- Modify: `app/components/session/SessionPlayer.tsx`

While the student is sketching the current bug, prefetch the *next* one's results so panel-open after navigation is also instant.

- [ ] **Step 1: Add the lookahead effect**

In `SessionPlayer.tsx`, find where `current` is computed (likely something like `const current = queue[idx]`). Add a `next` value:
```tsx
const next = queue[idx + 1]; // undefined at end of queue, that's fine
```

Add another `useEffect` next to the prefetch from Task 7:
```tsx
useEffect(() => {
  if (!next) return;
  const sci = next.taxonSpecies;
  const com = next.commonName;
  if (!sci || !com) return;
  void qc.prefetchQuery({
    queryKey: sketchfabQueryKey(sci, com),
    queryFn: async ({ signal }) => {
      const u = new URL("/api/sketchfab/search", window.location.origin);
      u.searchParams.set("scientific", sci);
      u.searchParams.set("common", com);
      const r = await fetch(u.toString(), { signal });
      if (!r.ok) throw new Error("prefetch failed");
      return r.json();
    },
    staleTime: 10 * 60_000,
  });
}, [next?.taxonSpecies, next?.commonName, qc]);
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`. In Network tab, observe: when the session starts on bug N, you should see **two** `/api/sketchfab/search` calls (one for N, one for N+1). On navigation to N+1, only one new call (for N+2).

- [ ] **Step 3: Commit**

```bash
git add app/components/session/SessionPlayer.tsx
git commit --no-gpg-sign -m "perf(sketchfab): N+1 lookahead prefetch for next bug"
```

---

## Task 9: E2E happy-path

**Files:**
- Create: `tests/e2e/sketchfab-panel.spec.ts`

- [ ] **Step 1: Write the e2e test**

```typescript
// tests/e2e/sketchfab-panel.spec.ts
import { test, expect } from "@playwright/test";

test("sketchfab panel opens, shows thumbnails, click opens new tab, timer pauses", async ({
  page, context,
}) => {
  // Stub the API to avoid hitting Sketchfab live in CI.
  await page.route("**/api/sketchfab/search*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rawHadResults: true,
        hits: [{
          uid: "test-uid",
          name: "Stubbed Bee Model",
          author: "Test Author",
          authorUsername: "testauthor",
          thumbnailUrl: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='256' height='144'><rect width='256' height='144' fill='%23333'/></svg>",
          viewerUrl: "https://sketchfab.com/3d-models/test-uid",
          licenseSlug: "by",
          matchedBy: "scientific",
        }],
      }),
    }),
  );

  await page.goto("/");
  // Start a session — the home page should have a start button; adjust selector
  // if needed by checking the actual home screen markup.
  await page.getByRole("button", { name: /start/i }).click();
  await page.waitForURL(/\/session/);

  // Capture timer text before opening the panel
  const timerLocator = page.locator("[data-testid='session-timer']");
  // If the timer element doesn't have a testid, add one in SessionPlayer first.
  const beforeText = await timerLocator.textContent();

  // Open Sketchfab panel
  await page.getByRole("button", { name: /sketchfab/i }).click();
  await expect(page.getByText("Sketchfab models")).toBeVisible();
  await expect(page.getByText("Stubbed Bee Model")).toBeVisible();

  // Timer text should be unchanged after 2 seconds (panel pauses it)
  await page.waitForTimeout(2000);
  const afterText = await timerLocator.textContent();
  expect(afterText).toBe(beforeText);

  // Clicking a thumbnail opens a new tab to sketchfab.com
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: /Stubbed Bee Model/ }).click(),
  ]);
  expect(popup.url()).toContain("sketchfab.com/3d-models/test-uid");

  // Closing the panel resumes the timer
  await page.keyboard.press("Escape");
  await expect(page.getByText("Sketchfab models")).toBeHidden();
  await page.waitForTimeout(2000);
  const resumedText = await timerLocator.textContent();
  expect(resumedText).not.toBe(afterText);
});
```

- [ ] **Step 2: Add the timer testid if missing**

Check `app/components/session/Timer.tsx` (or wherever the timer text is rendered). If there's no `data-testid="session-timer"` on the timer wrapper, add it. Trivial one-line change.

- [ ] **Step 3: Run the e2e**

Run: `npm run test:e2e -- sketchfab-panel.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/sketchfab-panel.spec.ts app/components/session/Timer.tsx
git commit --no-gpg-sign -m "test(sketchfab): e2e happy-path with timer pause assertion"
```

---

# Phase 2 — Precache for greyed-out button (optional perf/UX upgrade)

Phase 1 ships a working feature. Phase 2 avoids the "click → spinner → empty" UX for the ~half of species with zero Sketchfab models by pre-flagging them in a new table. The button greys out for those species and the panel skips the network call entirely.

## Task 10: Drizzle migration for species_metadata

**Files:**
- Create: `drizzle/0011_species_metadata.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Author the migration**

```sql
-- drizzle/0011_species_metadata.sql
-- Per-species metadata, primarily for caching expensive external lookups
-- (currently: Sketchfab "are there any models for this species?" flag).
-- Keyed by taxon_species (the same string used in the images table). One
-- row per distinct species; populated by scripts/sketchfab_enrichment.py.
CREATE TABLE `species_metadata` (
  `taxon_species` text PRIMARY KEY NOT NULL,
  -- Sketchfab Data API v3 — pre-checked "is there ≥1 relevant model?"
  -- Null when never checked; 0/1 when checked. NULL => unknown, treat
  -- as true in the UI to avoid hiding a feature for unchecked rows.
  `has_sketchfab_models` integer,
  `sketchfab_hit_count` integer,
  `sketchfab_last_checked_at` integer
);

CREATE INDEX `idx_species_metadata_sketchfab_checked`
  ON `species_metadata` (`sketchfab_last_checked_at`);
```

- [ ] **Step 2: Append the journal entry**

Edit `drizzle/meta/_journal.json` — add a new entry to the `entries` array (after `0010_facet_perf`):

```json
    {
      "idx": 11,
      "version": "6",
      "when": 1779100000000,
      "tag": "0011_species_metadata",
      "breakpoints": true
    }
```

Update the timestamp (`when`) to `Date.now()` at authoring time. The previous tag had `1779000000000`; this MUST be strictly larger.

- [ ] **Step 3: Verify on a DB copy**

```bash
cp data/db/line-of-bugs.db /tmp/migrate-test.db
DATABASE_URL=/tmp/migrate-test.db npx drizzle-kit migrate
```
Expected output: `0011_species_metadata` migration applied successfully.

Verify the table:
```bash
sqlite3 /tmp/migrate-test.db ".schema species_metadata"
```
Expected: table definition matches what was authored.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0011_species_metadata.sql drizzle/meta/_journal.json
git commit --no-gpg-sign -m "feat(db): add species_metadata table for external-lookup caches"
```

---

## Task 11: Schema + types update

**Files:**
- Modify: `db/schema.ts`

- [ ] **Step 1: Add the table definition**

At the end of `db/schema.ts` (before the generated-types section), add:

```typescript
// ──────────────────────────── species_metadata ─────────────

export const speciesMetadata = sqliteTable(
  "species_metadata",
  {
    taxonSpecies: text("taxon_species").primaryKey(),
    hasSketchfabModels: integer("has_sketchfab_models", { mode: "boolean" }),
    sketchfabHitCount: integer("sketchfab_hit_count"),
    sketchfabLastCheckedAt: integer("sketchfab_last_checked_at", { mode: "timestamp" }),
  },
  (t) => [
    index("idx_species_metadata_sketchfab_checked").on(t.sketchfabLastCheckedAt),
  ],
);

export type SpeciesMetadata = typeof speciesMetadata.$inferSelect;
export type NewSpeciesMetadata = typeof speciesMetadata.$inferInsert;
```

Append the type exports next to the existing `Image` / `Report` exports too.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add db/schema.ts
git commit --no-gpg-sign -m "feat(db): drizzle schema entry for species_metadata"
```

---

## Task 12: Python enrichment script

**Files:**
- Create: `scripts/sketchfab_enrichment.py`
- Create: `tests/python/test_sketchfab_enrichment.py`

Walks distinct `(taxon_species, common_name)` pairs from `images`, queries Sketchfab via the same logic as `tools/sketchfab_big_probe.py`, and UPSERTs into `species_metadata`. Concurrent (8 workers per CLAUDE.md guidance).

- [ ] **Step 1: Write the failing test**

```python
# tests/python/test_sketchfab_enrichment.py
"""Unit tests for sketchfab_enrichment — mocks HTTP, asserts UPSERT shape."""
from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from scripts.sketchfab_enrichment import (
    classify_species,
    upsert_metadata,
    SpeciesResult,
)


def _make_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """CREATE TABLE species_metadata (
              taxon_species TEXT PRIMARY KEY,
              has_sketchfab_models INTEGER,
              sketchfab_hit_count INTEGER,
              sketchfab_last_checked_at INTEGER
           )"""
    )
    conn.commit()
    conn.close()


def test_classify_returns_true_when_any_strict_relevant_hit():
    fake_response = {"results": [
        {"uid": "u1", "name": "Apis mellifera",
         "tags": [{"name": "insect"}],
         "categories": [{"slug": "animals-pets"}]}
    ]}
    with patch("scripts.sketchfab_enrichment._query") as mock_q:
        mock_q.return_value = fake_response["results"]
        result = classify_species("Apis mellifera", "honey bee", api_key="k")
    assert isinstance(result, SpeciesResult)
    assert result.has_models is True
    assert result.hit_count == 1


def test_classify_returns_false_when_no_relevant_hit():
    with patch("scripts.sketchfab_enrichment._query") as mock_q:
        mock_q.return_value = []  # zero hits both queries
        result = classify_species("Nonexistus speciosus", "fake bug", api_key="k")
    assert result.has_models is False
    assert result.hit_count == 0


def test_classify_returns_false_when_only_irrelevant_hits():
    irrelevant = [{"uid": "n", "name": "Bread", "tags": [{"name": "food"}],
                   "categories": [{"slug": "food-drink"}]}]
    with patch("scripts.sketchfab_enrichment._query") as mock_q:
        mock_q.return_value = irrelevant
        result = classify_species("Vanessa itea", "Yellow Admiral", api_key="k")
    assert result.has_models is False
    assert result.hit_count == 1   # raw hit count includes filtered


def test_upsert_metadata_writes_and_updates():
    with tempfile.TemporaryDirectory() as td:
        db = Path(td) / "t.db"
        _make_db(db)
        upsert_metadata(db, "Apis mellifera",
                        SpeciesResult(has_models=True, hit_count=5))
        # Second call updates rather than fails on PK conflict
        upsert_metadata(db, "Apis mellifera",
                        SpeciesResult(has_models=False, hit_count=0))
        with sqlite3.connect(db) as conn:
            row = conn.execute(
                "SELECT has_sketchfab_models, sketchfab_hit_count "
                "FROM species_metadata WHERE taxon_species = ?",
                ("Apis mellifera",),
            ).fetchone()
        assert row == (0, 0)
```

- [ ] **Step 2: Run — must fail**

Run: `.venv/bin/pytest tests/python/test_sketchfab_enrichment.py -v`
Expected: FAIL — `ModuleNotFoundError: scripts.sketchfab_enrichment`.

- [ ] **Step 3: Implement the script**

```python
# scripts/sketchfab_enrichment.py
"""Populate species_metadata.has_sketchfab_models for every distinct
taxon_species in the images table.

Run: .venv/bin/python -m scripts.sketchfab_enrichment [--limit N] [--max-age-days D]

Concurrency: 8 workers, well within Sketchfab fair-use.
"""
from __future__ import annotations

import argparse
import logging
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"
DEFAULT_DB = ROOT / "data" / "db" / "line-of-bugs.db"

log = logging.getLogger("sketchfab_enrichment")

INSECT_HINTS = {
    "insect", "insects", "insecta", "bug", "bugs", "beetle", "butterfly",
    "moth", "bee", "wasp", "ant", "fly", "grasshopper", "cricket", "mantis",
    "ladybug", "ladybird", "weevil", "dragonfly", "caterpillar", "entomology",
    "arthropod", "arthropoda", "pollinator", "pollinators",
}
INSECT_CATEGORY_SLUGS = {"animals-pets", "nature-plants"}


@dataclass
class SpeciesResult:
    has_models: bool
    hit_count: int  # raw, pre-filter


def _load_api_key() -> str:
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("SKETCHFAB_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("SKETCHFAB_API_KEY missing from .env.local")


def _query(q: str, api_key: str) -> list[dict]:
    """One Sketchfab search call. Returns first-page results or []."""
    try:
        r = requests.get(
            "https://api.sketchfab.com/v3/search",
            params={"type": "models", "q": q, "count": 6},
            headers={"Authorization": f"Token {api_key}"},
            timeout=20,
        )
        if r.status_code != 200:
            return []
        return r.json().get("results", []) or []
    except Exception as e:
        log.warning("query %r failed: %s", q, e)
        return []


def _is_strict_relevant(hit: dict, scientific: str, common: str) -> bool:
    text_parts = [
        hit.get("name", "") or "",
        " ".join(t.get("name", "") for t in hit.get("tags", [])),
        " ".join(c.get("name", "") for c in hit.get("categories", [])),
    ]
    text = " ".join(text_parts).lower()
    sci_toks = scientific.lower().split()
    if len(sci_toks) >= 2 and sci_toks[0] in text and sci_toks[-1] in text:
        return True
    com = common.lower().strip()
    if len(com.split()) >= 2 and com in text:
        return True
    if len(com.split()) == 1 and com in text:
        tag_set = {t.get("name", "").lower() for t in hit.get("tags", [])}
        cat_slugs = {c.get("slug", "") for c in hit.get("categories", [])}
        if tag_set & INSECT_HINTS or cat_slugs & INSECT_CATEGORY_SLUGS:
            return True
    return False


def classify_species(scientific: str, common: str, api_key: str) -> SpeciesResult:
    """Run both queries; return aggregate relevance + raw hit count."""
    sci_hits = _query(scientific, api_key)
    com_hits = _query(common, api_key)
    seen_uids: set[str] = set()
    raw = 0
    relevant = 0
    for h in (*sci_hits, *com_hits):
        uid = h.get("uid", "")
        if uid in seen_uids:
            continue
        seen_uids.add(uid)
        raw += 1
        if _is_strict_relevant(h, scientific, common):
            relevant += 1
    return SpeciesResult(has_models=relevant > 0, hit_count=raw)


def upsert_metadata(db_path: Path, taxon_species: str, result: SpeciesResult) -> None:
    now = int(time.time())
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """INSERT INTO species_metadata
                 (taxon_species, has_sketchfab_models, sketchfab_hit_count,
                  sketchfab_last_checked_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(taxon_species) DO UPDATE SET
                 has_sketchfab_models = excluded.has_sketchfab_models,
                 sketchfab_hit_count = excluded.sketchfab_hit_count,
                 sketchfab_last_checked_at = excluded.sketchfab_last_checked_at""",
            (taxon_species, 1 if result.has_models else 0, result.hit_count, now),
        )


def _list_species(db_path: Path, max_age_days: int, limit: int | None) -> list[tuple[str, str]]:
    """Return (scientific, common) pairs that need (re)checking."""
    cutoff = int(time.time()) - max_age_days * 86400
    with sqlite3.connect(db_path) as conn:
        sql = """
            SELECT DISTINCT i.taxon_species, i.common_name
            FROM images i
            LEFT JOIN species_metadata sm ON sm.taxon_species = i.taxon_species
            WHERE i.taxon_species IS NOT NULL
              AND i.common_name IS NOT NULL
              AND TRIM(i.taxon_species) <> ''
              AND TRIM(i.common_name) <> ''
              AND (sm.sketchfab_last_checked_at IS NULL
                   OR sm.sketchfab_last_checked_at < ?)
        """
        params: list = [cutoff]
        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)
        return [(r[0], r[1]) for r in conn.execute(sql, params).fetchall()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite db path")
    parser.add_argument("--limit", type=int, default=None, help="cap species processed")
    parser.add_argument("--max-age-days", type=int, default=1,
                        help="skip species checked within this window (default 1 = daily cron)")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    api_key = _load_api_key()
    db_path = Path(args.db)

    pairs = _list_species(db_path, args.max_age_days, args.limit)
    log.info("processing %d species", len(pairs))
    t0 = time.time()

    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(classify_species, sci, com, api_key): (sci, com)
                for sci, com in pairs}
        for f in as_completed(futs):
            sci, com = futs[f]
            try:
                result = f.result()
                upsert_metadata(db_path, sci, result)
            except Exception as e:
                log.error("classify %r failed: %s", sci, e)
                continue
            done += 1
            if done % 100 == 0:
                log.info("  %d/%d  (%.1f/s)", done, len(pairs), done / (time.time() - t0))

    log.info("done in %.1fs — %d species processed", time.time() - t0, done)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run — must pass**

Run: `.venv/bin/pytest tests/python/test_sketchfab_enrichment.py -v`
Expected: PASS — all four tests green.

- [ ] **Step 5: Smoke against real API on 5 species**

Make a DB copy so the smoke doesn't pollute the real metadata table:
```bash
cp data/db/line-of-bugs.db /tmp/smoke.db
.venv/bin/python -m scripts.sketchfab_enrichment --db /tmp/smoke.db --limit 5 --max-age-days 0
sqlite3 /tmp/smoke.db "SELECT * FROM species_metadata;"
```
Expected: 5 rows printed; at least some have `has_sketchfab_models=1`.

- [ ] **Step 6: Commit**

```bash
git add scripts/sketchfab_enrichment.py tests/python/test_sketchfab_enrichment.py
git commit --no-gpg-sign -m "feat(sketchfab): enrichment script populates species_metadata"
```

---

## Task 13: API route reads has_sketchfab_models

**Files:**
- Modify: `lib/sketchfab/search.ts` (or add `lib/sketchfab/has-models.ts`)
- Modify: `app/api/sketchfab/search/route.ts`
- Modify: `tests/api/sketchfab-search-route.test.ts`

- [ ] **Step 1: Add the DB lookup helper**

Create `lib/sketchfab/has-models.ts`:

```typescript
// lib/sketchfab/has-models.ts
import { db } from "@/db";
import { speciesMetadata } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Returns the pre-cached "does Sketchfab have models for this species" flag.
 *   - true   → at least one relevant model existed at last check
 *   - false  → checked, none found
 *   - null   → never checked (caller should treat as "unknown" / fetch live)
 */
export function hasSketchfabModels(taxonSpecies: string): boolean | null {
  const row = db.select({
    has: speciesMetadata.hasSketchfabModels,
  })
    .from(speciesMetadata)
    .where(eq(speciesMetadata.taxonSpecies, taxonSpecies))
    .get();
  if (!row) return null;
  return row.has === null ? null : row.has;
}
```

- [ ] **Step 2: Update the route to short-circuit**

Edit `app/api/sketchfab/search/route.ts`:

```typescript
import { searchSketchfab } from "@/lib/sketchfab/search";
import { hasSketchfabModels } from "@/lib/sketchfab/has-models";

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

  // Cache short-circuit: skip the API call for species we already
  // know have nothing. The client uses precachedHasModels to decide
  // whether to grey out the button.
  const precached = hasSketchfabModels(scientific);
  if (precached === false) {
    return new Response(
      JSON.stringify({ hits: [], rawHadResults: false, precachedHasModels: false }),
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300, s-maxage=3600" } },
    );
  }

  const result = await searchSketchfab({ scientific, common, apiKey });
  return new Response(
    JSON.stringify({ ...result, precachedHasModels: precached }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
      },
    },
  );
}
```

- [ ] **Step 3: Add a test for the short-circuit path**

Append to `tests/api/sketchfab-search-route.test.ts`:

```typescript
vi.mock("@/lib/sketchfab/has-models", () => ({
  hasSketchfabModels: vi.fn(),
}));

// inside the describe block:
it("short-circuits with empty hits when precache says no models", async () => {
  const { hasSketchfabModels } = await import("@/lib/sketchfab/has-models");
  (hasSketchfabModels as ReturnType<typeof vi.fn>).mockReturnValue(false);
  const r = await GET(new Request(
    "http://x/api/sketchfab/search?scientific=Nothing&common=here"
  ));
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.hits).toEqual([]);
  expect(body.precachedHasModels).toBe(false);
  expect(searchSketchfab).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run — must pass**

Run: `npm run test -- tests/api/sketchfab-search-route.test.ts`
Expected: PASS — all tests including the new one.

- [ ] **Step 5: Commit**

```bash
git add lib/sketchfab/has-models.ts app/api/sketchfab/search/route.ts tests/api/sketchfab-search-route.test.ts
git commit --no-gpg-sign -m "feat(sketchfab): route reads species_metadata for short-circuit"
```

---

## Task 14: Frontend greyed-out button

**Files:**
- Modify: `app/components/session/SketchfabBrowsePanel.tsx`
- Modify: `app/components/session/SessionPlayer.tsx`

- [ ] **Step 1: Expose a "has models?" hook**

Add at the bottom of `SketchfabBrowsePanel.tsx`:

```tsx
/** Lightweight precheck: hits the same endpoint but reads only
 *  precachedHasModels. Cached identically to the full panel query
 *  so the panel reuses the result if it later opens. */
export function useSketchfabAvailability(scientific: string, common: string) {
  const { data } = useQuery({
    queryKey: sketchfabQueryKey(scientific, common),
    queryFn: ({ signal }) => fetchSketchfab(scientific, common, signal),
    enabled: !!scientific && !!common,
    staleTime: 10 * 60_000,
  });
  // Tri-state: undefined (loading) | true (has hits or unknown) | false (precache says none)
  if (!data) return undefined;
  if (data.hits.length > 0) return true;
  // If precachedHasModels is explicitly false, no models. Otherwise treat as unknown.
  return (data as { precachedHasModels?: boolean | null }).precachedHasModels !== false;
}
```

Export `fetchSketchfab` if it isn't already.

- [ ] **Step 2: Use it in SessionPlayer to disable the button**

In `SessionPlayer.tsx`, import and call the hook:

```tsx
import { useSketchfabAvailability } from "./SketchfabBrowsePanel";

// inside the component:
const sketchfabAvailable = useSketchfabAvailability(
  current.taxonSpecies ?? "",
  current.commonName ?? "",
);
// undefined while loading; true if hits exist or unchecked; false if precache rules it out
```

Pass it down by extending the action-bar props:
```tsx
sketchfabDisabled={sketchfabAvailable === false}
```

In `SessionActionBar.tsx`, add `sketchfabDisabled?: boolean` to Props (default false) and apply:
```tsx
<IconBtn
  label="sketchfab"
  hint="K"
  active={props.sketchfabOpen}
  disabled={props.sketchfabDisabled ?? false}
  onClick={props.onToggleSketchfab}
>
  ▦
</IconBtn>
```

The `IconBtn` already swallows clicks when `disabled` (see `app/components/ui/IconBtn.tsx`), so no behavior change needed there.

- [ ] **Step 3: Add a test**

Append to `tests/components/SessionActionBar.test.tsx`:
```tsx
it("disables the Sketchfab button when sketchfabDisabled=true", () => {
  const onToggle = vi.fn();
  render(<SessionActionBar
    {...baseProps}
    sketchfabOpen={false}
    sketchfabDisabled={true}
    onToggleSketchfab={onToggle}
  />);
  const btn = screen.getByRole("button", { name: /sketchfab/i });
  expect(btn).toBeDisabled();
  fireEvent.click(btn);
  expect(onToggle).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run — must pass**

Run: `npm run test`
Expected: every test still green.

- [ ] **Step 5: Manual smoke**

Run: `npm run dev`. Open a session on a species you know has no Sketchfab models (e.g. `Plathemis lydia` / Common Whitetail per the probe data). The ▦ button should grey out within a few seconds (after the prefetch resolves and returns `precachedHasModels: false`).

- [ ] **Step 6: Commit**

```bash
git add app/components/session/SketchfabBrowsePanel.tsx app/components/session/SessionActionBar.tsx app/components/session/SessionPlayer.tsx tests/components/SessionActionBar.test.tsx
git commit --no-gpg-sign -m "feat(sketchfab): grey out trigger button when precache says no models"
```

---

## Self-review checklist (for plan authors)

Before handing this plan to an executor, the author should confirm:

1. **Spec coverage**
   - [x] Action-bar button → Task 5
   - [x] Inline panel above the bar → Task 3, 4
   - [x] Thumbnail preview grid → Task 3 (results state)
   - [x] Click opens Sketchfab in a new tab → Task 3 (`target="_blank"`)
   - [x] Timer pauses while open → Task 6
   - [x] Pre-cache `has_sketchfab_models` → Tasks 10–14
   - [x] Performance prefetch → Tasks 7, 8
   - [x] Design-system alignment → Task 4 + "Design system mapping" section above
   - [x] Attribution per ToS → Task 3 (author chip, license tooltip, "Powered by Sketchfab" badge)

2. **No placeholders** — every code step contains complete, runnable code. No "TBD" / "fill in".

3. **Type consistency** —
   - `SketchfabHit` shape consistent across `lib/sketchfab/types.ts`, route handler, panel, and tests.
   - `sketchfabOpen` / `onToggleSketchfab` / `sketchfabDisabled` prop names consistent between `SessionActionBar` and `SessionPlayer`.
   - `sketchfabQueryKey()` reused by both the panel and the prefetch effects so React Query dedupes correctly.

## Decisions made (locked in 2026-05-16)

1. **Phase ordering:** ship both phases together; they're both small.
2. **Click-through:** new tab → Sketchfab. No inline 3D embed (too expensive, watermark concerns, WebGL context cost).
3. **Result count + scroll:** server returns up to 12 relevant hits per species; UI shows a scrollable multi-row grid. Final visible-row count tuned via the `audit` skill at Task 4 step 3 (Phase 1) — user explicitly wants the visual evaluated rather than guessed. Mobile layout is a first-class concern, not an afterthought.
4. **Enrichment cadence:** daily. Default `--max-age-days=1`. Cron lives on the remote box (separate scheduling machine), not in-app. A separate deploy follow-up (outside this plan) should add the systemd timer or crontab entry on the remote — invoke for now manually after Phase 2 ships to seed the table.

## Deploy follow-up (out-of-scope reminder)

After Task 14 lands and the table is seeded manually, add a daily cron entry on the remote scheduling host:

```
0 4 * * *  cd /path/to/line-of-bugs && .venv/bin/python -m scripts.sketchfab_enrichment >> /var/log/sketchfab_enrichment.log 2>&1
```

This is a deploy-runbook change, not an application code change — track separately.
