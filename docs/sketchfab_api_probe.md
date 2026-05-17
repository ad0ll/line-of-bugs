# Sketchfab Integration — Research Findings (2026-05-16)

Two scopes investigated:
1. **Search-API behavior** — can we reliably find 3D models for our species?
2. **In-app preview-panel feature** — is the user-proposed UX feasible?

Probes: `tools/sketchfab_probe.py` (initial 16-species), `tools/sketchfab_big_probe.py`
(100-species × 4 strategies). Raw JSON: `/tmp/sketchfab_probe.json`,
`/tmp/sketchfab_big_probe.json`. Full single-model record: `/tmp/sf_model_full.json`.

## TL;DR

- **Hit rate: 22/100 species have a confidently-relevant model**, but those
  22 are the popular ones — they cover **~53% of the image corpus by
  volume**. ~Half of student sessions will see useful results, half will
  see "nothing for this species."
- **The feature is doable.** Search API returns thumbnails + embed URLs in
  one call; embed iframes render anonymously with no X-Frame blocking;
  thumbnail CDN sets year-long cache headers. No paid tier needed for
  read-only use.
- **Recommended search strategy: run scientific + common in parallel,
  union the results.** Each catches species the other misses.
- **One real cost:** of ~6,500 species in the DB, only ~1,400 will have
  models. We should pre-cache `has_sketchfab_models` so the button can be
  greyed out — clicking through to "no results" repeatedly is a worse UX
  than knowing in advance.

## 1. API routes hit (and what's available)

The Sketchfab Data API v3 lives at `https://api.sketchfab.com/v3/`. Auth
via `Authorization: Token <key>` header. Both endpoints we used are
**public-readable** (the key is required by ToS but read endpoints don't
gate by paid tier).

Endpoints we actually exercised:

| Route                            | Used for                                       | Auth needed | Status    |
|----------------------------------|-----------------------------------------------|-------------|-----------|
| `GET /v3/search?type=models`     | Keyword + filtered model search               | Token       | works     |
| `GET /v3/models/<uid>`           | Full single-model record (categories, etc.)   | Token       | works     |
| `GET /models/<uid>/embed` (web)  | Iframe embed HTML                              | none        | 200, no X-Frame |
| `HEAD media.sketchfab.com/…`     | Thumbnail CDN                                  | none        | 200, `cache-control: public, max-age=31536000` |

Other endpoints in the v3 API (per developer docs, not exercised): models
upload/edit/delete, collections, users, organizations, comments, likes,
backgrounds, environments, matcaps, tags, categories, skills, licenses,
account, profile, subscriptions, downloads.

Public HTML pages (`sketchfab.com/3d-models/<slug>-<uid>`) are gated by
an Akamai bot challenge (HTTP 202, 0 bytes) — **you cannot scrape them
directly**. This doesn't matter: the API returns the same fields the page
renders, because the page is a React app over this same API.

### `/v3/search` parameters (empirically verified)

All return 200 with sensible results:

| Param          | Type         | Example                       |
|----------------|--------------|-------------------------------|
| `type`         | enum         | `models`                      |
| `q`            | string       | `Apis mellifera`              |
| `count`        | int (≤24)    | `5`                           |
| `categories`   | slug or CSV  | `animals-pets`                |
| `tags`         | slug or CSV  | `insect,entomology`           |
| `license`      | slug         | `by` (CC-BY)                  |
| `downloadable` | bool         | `true`                        |
| `animated`     | bool         | `true`                        |
| `staffpicked`  | bool         | `true`                        |
| `sort_by`      | field        | `-likeCount`, `-publishedAt`  |
| `cursor`       | opaque       | from `next` URL               |

Query syntax: `"exact phrase"` (quotes work), `monarch OR butterfly` (OR
works), `monarch -ladybug` (exclusion works).

### What a single search hit returns

The search response is **self-sufficient** — no follow-up calls needed
for a UI grid. Each hit has:

```
uid, name, description, user.username, user.displayName, user.profileUrl,
tags[], categories[], thumbnails.images[1920x1080 … 64x36],
embedUrl ("https://sketchfab.com/models/<uid>/embed"),
viewerUrl ("https://sketchfab.com/3d-models/<slug>-<uid>"),
license.slug, isDownloadable, isAgeRestricted,
viewCount, likeCount, faceCount, vertexCount,
animationCount, soundCount, archives, createdAt, publishedAt
```

Five thumbnail tiers per model — 1920×1080, 1024×576, 720×405, 256×144,
64×36. The 256×144 is ideal for a grid; the 720×405 for a hover/expanded
preview.

### Rate limits

Not officially documented in any page WebFetch could reach (the help docs
all redirect to fab.com after Epic's acquisition; the support pages are
JS-rendered). Empirically: **400 requests in 10.2s with 8 concurrent
workers, zero 429s.** That's ~40 req/s sustained on an authenticated key.
For our use case (one request per species during a one-shot enrichment,
plus on-demand requests when users click the button) we're nowhere near
any plausible limit.

Sketchfab's published "fair use" policy (from search results) caps users
who consume >99th-percentile traffic. Pre-caching to a local table avoids
ever hitting limits.

## 2. Search-strategy comparison

100 species sampled from the DB: 25 top-volume (>50 images),
35 mid (5-20), 40 tail (1-3). Each species hit with 4 strategies:

| Strategy   | Query                                                | Filter            |
|------------|------------------------------------------------------|-------------------|
| S1_sci     | `q=<scientific binomial>`                           | none              |
| S2_sci_cat | `q=<scientific binomial>`                           | `animals-pets`    |
| S3_com     | `q=<common name>`                                    | none              |
| S4_com_cat | `q=<common name>`                                    | `animals-pets`    |

### Hit rate (≥1 result on first page)

| Tier | n  | S1 sci | S2 sci+cat | S3 com | S4 com+cat |
|------|----|--------|------------|--------|------------|
| top  | 25 | 12     | 10         | 9      | 8          |
| mid  | 35 | 5      | 4          | 8      | 5          |
| tail | 40 | 4      | 2          | 12     | 7          |

### Strict relevance (full binomial OR full common name in metadata)

The looser heuristic over-counts single-word common names (`Coronet` →
Dodge Coronet cars; `Marble` → Roman villa; `Maple` → maple trees).
Stricter: require full binomial as substring OR multi-word common name
as substring OR single-word common name + insect tag.

| Tier | n  | sci-strict | com-strict | either | image-weighted coverage |
|------|----|------------|------------|--------|--------------------------|
| top  | 25 | 11         | 6          | **11** | 2310/4119 (**56%**)      |
| mid  | 35 | 3          | 4          | **5**  | 49/277 (18%)             |
| tail | 40 | 0          | 6          | **6**  | 10/66 (15%)              |
| **TOTAL** | **100** | **14** | **16** | **22** | **2369/4462 (53%)** |

Two interpretations of the same data:

- **22% of distinct species** have ≥1 confidently relevant model.
- **53% of typical student sessions** will see a relevant model, because
  popular species are over-represented in the corpus.

### Recommendation

**Run S1 and S3 in parallel, union the results, deduplicate by `uid`.**
- Scientific catches museum scans (Yale Peabody, Virginia Tech, ETAIN)
  — high precision (100% in top/mid) but lower recall (artists don't
  always use Latin names).
- Common name catches popular hobbyist models — moderate precision,
  higher recall for well-known species.
- They're complementary: only 8/100 species hit on both, but 22/100 hit
  on at least one.

Category filter (`animals-pets`) reduces noise marginally but also drops
real hits (e.g. Hercules-beetle CT scan tagged `science-technology`). Not
worth the recall loss for our use case.

### False-positive patterns to display-time filter

When a query returns hits but the relevance flag is low, the panel should
either degrade gracefully ("see all results on Sketchfab") or hide them.
Patterns we saw:

- **Username matches.** `q=Vanessa itea` → 3 hits by `@vanessa3d`
  (puddings, bread). Filter: require the query token to appear outside
  `user.username` before treating a hit as confident.
- **Single-word common-name collisions.** `q=Monarch` returned 240+ hits
  including Star Wars admirals and the Miraculous Ladybug character.
  `q=Coronet` returned classic cars (Dodge Coronet). Filter: require an
  insect-context tag (`insect|bug|beetle|butterfly|...`) or category
  (`animals-pets|nature-plants`) when the common name is one word.
- **Cross-language fuzzy matches.** `q=Javanese Grasshopper` returned a
  German Maya-the-Bee figure. Acceptable failure mode (still an insect);
  the insect-context filter catches genuinely wrong results.

## 3. Embed feasibility (the feature itself)

User's proposed UX: a Sketchfab action button opens an inline panel above
the action bar showing thumbnail previews of search results; clicking
opens the model on Sketchfab; timer suspends while the panel is open.

### Mechanics — confirmed working

- **Iframe embed:** `https://sketchfab.com/models/<uid>/embed?...`
  returns HTTP 200 anonymously. No `X-Frame-Options` or restrictive CSP
  blocking — embeds work on third-party origins.
- **Embed customization** (URL params, no JS SDK needed for MVP):
  - `autostart=0` — show poster + play button (recommended; avoids
    auto-loading WebGL contexts for every preview)
  - `ui_controls=0`, `ui_infos=0`, `ui_inspector=0`, `ui_watermark=0`
    (the last requires Business+ to enforce — we don't have that, so the
    watermark stays)
  - `transparent=1` if we want to overlay the model on app background
  - `preload=1` to start downloading on iframe load
  - `dnt=1` to respect Do Not Track
- **JS Viewer SDK** (`sketchfab-viewer-1.12.1.js`) — not needed for MVP.
  Useful if we later want play/pause from app code, screenshot extraction,
  or camera scripting.
- **Thumbnail CDN:** `media.sketchfab.com/...` serves jpegs with
  `cache-control: public, max-age=31536000`. Browser caches forever — we
  can use the raw URLs without proxying.
- **No paid tier required** for read-only embedding of free public
  models. Watermark removal needs Business; UI button customization
  needs Premium — neither is necessary for our use case.

### Architecture suggestion (rough; design proper in a follow-up)

- **Server-side API proxy** (Next.js route handler):
  `GET /api/sketchfab/search?species=<sci>&common=<name>` runs both
  queries server-side (key never leaves the server), unions + dedupes,
  returns trimmed hits (uid, name, user, thumbnail_256, embedUrl,
  viewerUrl, relevance flag).
- **Caching:** Two layers.
  1. **Pre-cache `has_sketchfab_models`** during a cron run over all
     species. New table `species_metadata(taxon_species PK, sci_hit_count,
     com_hit_count, top_uids TEXT, last_checked_at)`. Migration via
     `drizzle/000N_species_metadata.sql`. Refresh weekly.
  2. **Request-time SWR** in the route handler — when a student clicks
     the button for species X, return cached results immediately and
     refresh in the background if stale.
- **UI panel:**
  - Trigger: existing action-bar button (already in spec per
    `docs/sketchfab-notes.md`).
  - Layout: thumbnail grid (256px thumbnails), 2-3 columns, max 5-6
    results. Each card shows thumbnail + model name + author. Click opens
    `viewerUrl` in a new tab.
  - Optional: hover/tap-to-preview using the iframe embed inline (lazy
    — only mount the iframe on interaction to avoid five WebGL contexts).
  - Empty state: "No models found on Sketchfab for this species. [Search
    Sketchfab anyway →]" linking to a manual search URL.
- **Timer suspend integration:** The session state machine has the
  authority. Suspend on panel open, resume on close (not on click-through
  — clicking a thumbnail opens a new tab; the panel can stay open).
- **License display:** Each hit has a `license.slug`. CC-BY models
  should show attribution to `user.displayName`. The panel should
  surface license + author so students understand reuse terms if they
  download.

### Latency

- One search round-trip is ~150-300ms warm. Running two queries (sci +
  com) in parallel is bounded by the slower of the two — call it ~400ms.
- With pre-cached results, the panel opens instantly; the background
  refresh hides any cold latency on subsequent opens.

### Risks

- **Real risk: low overall coverage.** Many "common" insects in our
  corpus have zero Sketchfab models. Need to pre-flag this so students
  aren't repeatedly clicking the button on no-result species. The
  greyed-out button is the right pattern.
- **Mild risk: search-result quality variance.** Top hits for popular
  species are excellent (Yale Peabody museum scans). Top hits for
  obscure species default to fuzzy matches. Strict-relevance filter on
  the server protects against displaying garbage.
- **Watermark.** Sketchfab logo + "Sketchfab" link will appear on every
  embed. This is fine — it's free advertising for them and signals to
  students where the content comes from.
- **Embed performance.** Each iframe spins up a WebGL context. If we
  show 6 inline embeds, that's 6 WebGL contexts — browsers cap this
  (~16 in Chrome, fewer on Safari). Recommend: thumbnails by default,
  lazy-load the iframe only on click/hover for one model at a time.

## 4. Open questions for you

1. **Greyed-out button strategy** — implement `has_sketchfab_models`
   pre-cache before shipping the feature, or ship without it and accept
   the worse UX initially?
2. **Click-through behavior** — open the Sketchfab page in a new tab
   (timer continues paused), or load the inline embed (timer paused,
   stays in our app)? The former is simpler; the latter is more
   immersive.
3. **Result count cap** — 5 results per species, or show "see all on
   Sketchfab" link after N results?
4. **Cron cadence** — weekly refresh of `has_sketchfab_models` is cheap
   (~6500 species × 2 queries = 13k calls = ~7 min wall time at 40 req/s).
   Daily is also viable.

## 5. Scripts retained

- `tools/sketchfab_probe.py` — 16-species deep dive with single-model
  verification
- `tools/sketchfab_big_probe.py` — 100-species × 4-strategy comparison
- Both reusable for future testing; delete when the feature ships and
  the `has_sketchfab_models` enrichment script supersedes them.
