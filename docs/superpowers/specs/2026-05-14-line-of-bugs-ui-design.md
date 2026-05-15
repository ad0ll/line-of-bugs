# line-of-bugs — UI Design Spec

**Status:** Draft for user review (2026-05-14)
**Companion docs:**
- `docs/ui-spec.md` — annotated conversation capture (decisions + direct quotes)
- `docs/sketchfab-notes.md` — deferred Sketchfab integration

This document is the *implementable architecture spec*. Approve this and it
unlocks the implementation-plan phase. For decision-history, see ui-spec.md.

---

## 1. Goal

Build **line-of-bugs**: a gesture/figure drawing webapp where art students
practice on insect photographs. Sessions show one image at a time on a
fixed interval (30s / 60s / 2m / 3m / 5m / 10m / custom) with audio cues.
The app has three surfaces (home, session, gallery) plus a hidden admin
view for content moderation.

5,092 curated images are already on disk + indexed in SQLite (see
`docs/ui-spec.md` §13 for source breakdown). The UI consumes that
pre-built data layer.

### Non-goals
- Eagle-app integration, custom-class management, in-app tagging, image
  upload, user accounts. All Eagle-specific patterns explicitly excluded.
- Image manipulation beyond display tools (B&W, zoom, magnifier).
- Multi-admin support — single env-var admin password is sufficient.
- Sketchfab integration in MVP (deferred per `sketchfab-notes.md`).

---

## 2. Tech stack

- **Framework**: Next.js 16.x with the App Router
- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js 24 LTS (pinned in `.nvmrc`)
- **Database**: SQLite via `better-sqlite3` (synchronous, native module)
- **ORM**: Drizzle ORM (object-form init: `drizzle({ client, schema })`)
- **Full-text search**: SQLite FTS5 (raw-SQL migration; query via Drizzle
  `sql` template)
- **Styling**: CSS custom properties + design tokens ported from
  `~/projects/eagle-gesture-drawing`
- **Fonts**: `next/font/google` — Zen Maru Gothic, JetBrains Mono, Fraunces
- **Audio**: Web Audio API, procedural cues ported from
  `eagle-gesture-drawing/src/audio-cues.js`

### Required `next.config.ts`

```typescript
export default {
  serverExternalPackages: ['better-sqlite3'],
  experimental: { cacheComponents: true },
};
```

---

## 3. Architecture

### Project layout

```
/
├── next.config.ts
├── proxy.ts                              # HTTP Basic Auth for /admin/*
├── public/
│   ├── globals.css                       # ported from eagle
│   └── robots.txt                        # Disallow: /admin/
├── app/
│   ├── layout.tsx                        # next/font, theme provider
│   ├── page.tsx                          # /  (home)
│   ├── session/page.tsx                  # /session
│   ├── gallery/page.tsx                  # /gallery
│   ├── gallery/loading.tsx               # skeleton for streamed grid
│   ├── report/[id]/page.tsx              # full-page report (URL hit/refresh)
│   ├── @modal/
│   │   ├── default.tsx                   # null when slot inactive
│   │   └── (.)report/[id]/page.tsx       # intercepting modal
│   ├── admin/
│   │   └── reports/page.tsx              # Basic-Auth gated
│   └── api/
│       ├── img/[name]/route.ts           # streams data/images/
│       ├── medium/[name]/route.ts        # streams data/medium/
│       ├── thumb/[name]/route.ts         # streams data/thumbnails/
│       ├── session/start/route.ts        # POST: builds queue
│       └── species/search/route.ts       # GET: autocomplete (FTS5)
├── actions/                              # Server Functions
│   ├── submitReport.ts
│   ├── dismissReport.ts
│   ├── hideImage.ts
│   ├── deleteImage.ts
│   └── _invalidation.ts                  # cache-tag bundles
├── components/
│   ├── home/                             # IntervalPicker, SubjectFilter, RepeatModeToggle
│   ├── session/                          # SessionPlayer, Timer, ProgressBar, ActionBar, SourceInfoChip
│   ├── gallery/                          # GalleryGrid, SpeciesAutocomplete, FilterChips, HoverZoom
│   ├── modal/Modal.tsx                   # frame for intercept route
│   └── ui/                               # IconBtn (ported from eagle)
├── lib/
│   ├── tokens.ts                         # ports eagle/src/design-tokens.js
│   ├── audio.ts                          # ports eagle/src/audio-cues.js
│   ├── order-colors.ts                   # Pastel Goth Kawaii palette (17 hex)
│   ├── hooks/useHighResTimer.ts          # ports eagle/src/timer-hook.jsx
│   ├── auth.ts                           # bcrypt-compare helper for Basic Auth re-verify
│   ├── preload-manager.ts                # ports eagle's PreloadManager
│   └── queries/
│       ├── session.ts                    # buildSessionPool, getImage
│       ├── gallery.ts                    # searchGallery, searchSpecies, listInstitutions
│       └── reports.ts                    # getPendingReports, getPendingCount
├── db/                                   # (already built)
│   ├── schema.ts                         # + adds `hidden` boolean column
│   ├── index.ts                          # HMR-safe singleton
│   └── seed.ts                           # ends with `ANALYZE`
└── drizzle/
    ├── 0000_grey_starbolt.sql            # initial migration (built)
    └── 0001_fts5.sql                     # FTS5 virtual table + triggers
```

### Layer separation
1. **Data layer** (`db/`, `lib/queries/`): Drizzle queries, `'use cache'`
   wrapped, organized by surface.
2. **Server layer** (`app/api/*` Route Handlers + `actions/*` Server
   Functions): thin wrappers — handlers stream bytes / handle GET; Server
   Functions handle form-driven mutations + cache invalidation.
3. **UI layer** (`app/*/page.tsx` + `components/*`): RSC by default;
   `"use client"` boundary only on interactive components (SessionPlayer,
   SpeciesAutocomplete, HoverZoom, ActionBar).

---

## 4. Data model

### SQLite schema (Drizzle)

```typescript
images
  image_id            text PRIMARY KEY
  collection_id       text NOT NULL                  -- groups same-specimen multi-angle sets
  source              text NOT NULL                  -- enum: inaturalist | bugwood | smithsonian | usda-ars
  source_id           text NOT NULL
  source_page_url     text NOT NULL
  image_url           text NOT NULL                  -- upstream CDN; opens on gallery click
  filename            text NOT NULL                  -- "images/<name>.jpg"
  thumbnail_filename  text NOT NULL                  -- "thumbnails/<name>.jpg"
  medium_filename     text NOT NULL                  -- "medium/<name>.jpg"  (1024px)
  file_size_bytes     integer
  file_sha256         text NOT NULL
  width               integer
  height              integer
  license             text NOT NULL                  -- SPDX-style code
  license_url         text
  photographer_attribution text
  photographer        text
  institution         text
  taxon_order         text                           -- Coleoptera, Lepidoptera, etc.
  taxon_species       text
  common_name         text
  subject_type        text NOT NULL                  -- enum: nature | specimen
  view_label          text                           -- dorsal | lateral | etc.
  description         text
  captured_date       text
  hidden              integer NOT NULL DEFAULT 0     -- admin-managed soft-delete
  added_at            integer NOT NULL DEFAULT (unixepoch())

reports
  id                  integer PRIMARY KEY AUTOINCREMENT
  image_id            text NOT NULL REFERENCES images(image_id) ON DELETE CASCADE
  category            text NOT NULL                  -- enum: low-resolution | spooky | cropped | ai-generated | other
  message             text                           -- 250-char max, only for "other"
  created_at          integer NOT NULL DEFAULT (unixepoch())
  resolved_at         integer
  resolved_action     text                           -- enum: dismissed | image-hidden | image-deleted

images_fts (virtual table, FTS5)
  image_id            UNINDEXED
  common_name         indexed
  taxon_species       indexed
  -- tokenize = 'unicode61 remove_diacritics 2'

Triggers: AFTER INSERT/UPDATE/DELETE on images → sync images_fts
```

### Indexes
- `images`: idx on `taxon_species`, `common_name`, `collection_id`,
  `source`, `subject_type`, `institution`, `taxon_order`, `file_sha256`,
  `hidden`
- `reports`: idx on `image_id`, `created_at`, and a partial idx on
  `image_id WHERE resolved_at IS NULL` (hot path: "is this image hidden?")
- `ANALYZE` runs at the end of seed for query-planner statistics

### "Hidden" predicate

An image is hidden from regular users iff:

```sql
images.hidden = 1
OR EXISTS (SELECT 1 FROM reports
           WHERE reports.image_id = images.image_id
             AND reports.resolved_at IS NULL)
```

- `hidden` column: permanent admin-driven hide (cleared only by admin)
- Unresolved-report predicate: auto-hide while moderation is pending

---

## 5. Routes & surfaces

| Path | Component | Type | Purpose |
|------|-----------|------|---------|
| `/` | HomeScreen | RSC + client form | Pick interval / subject filter / repeat mode → POST to session/start |
| `/session?session=<uuid>` | SessionPlayer | Client | Fullscreen drawing player |
| `/gallery` | GalleryPage | RSC (streamed grid) | Search/filter/browse the library |
| `/report/[id]` | ReportForm | RSC + client form | Full-page report (URL/refresh path) |
| `/@modal/(.)report/[id]` | ReportForm in Modal | RSC + client form | Intercepted modal over current view |
| `/admin/reports` | AdminReports | RSC | Pending-report queue, gated by `proxy.ts` Basic Auth |
| `/api/img/[name]` | Route Handler | streams full-size JPEG |
| `/api/medium/[name]` | Route Handler | streams 1024px JPEG |
| `/api/thumb/[name]` | Route Handler | streams 512px JPEG |
| `/api/session/start` | Route Handler (POST) | builds + stores randomized image queue |
| `/api/species/search?q=…` | Route Handler (GET) | FTS5 autocomplete |

---

## 6. Image-serving tiers

Three pre-baked sizes on disk (generated inline by the download scripts):

| Tier | Path | Size avg | Used by |
|------|------|---------|---------|
| Full | `data/images/<name>.jpg` | ~1.2 MB | Session player + click-from-gallery (opens upstream `image_url`) |
| Medium | `data/medium/<name>.jpg` | ~130 KB, 1024px max edge | Gallery hover preview |
| Thumbnail | `data/thumbnails/<name>.jpg` | ~35 KB, 512px max edge | Gallery grid tiles |

**Route handler pattern** (same shape for all three):
```typescript
export async function GET(_req, { params }) {
  const { name } = await params;
  const safe = name.replace(/[^a-z0-9_.-]/gi, '');     // path-traversal guard
  const filePath = path.join(process.cwd(), 'data', '<tier>', safe);
  const stream = fs.createReadStream(filePath);
  return new Response(stream, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
```

No `next/image` (no Sharp dependency); we pre-baked the variants we need.

---

## 7. Session player (the meatiest component)

### Lifted patterns from `~/projects/eagle-gesture-drawing`

| Source | Target | Status |
|--------|--------|--------|
| `src/design-tokens.js` | `lib/tokens.ts` | Lift verbatim → TS |
| `assets/styles.css` (:root + utilities) | `app/globals.css` | Lift verbatim |
| `src/audio-cues.js` | `lib/audio.ts` | Lift verbatim |
| `src/timer-hook.jsx` | `lib/hooks/useHighResTimer.ts` | Lift verbatim |
| (eagle's PreloadManager pattern) | `lib/preload-manager.ts` | Lift adapted |
| `src/screen-session.jsx` (chrome-hide, keyboard, image render) | `app/components/SessionPlayer.tsx` | Lift core parts |
| `src/session-action-bar.jsx` (IconBtn primitive, layout) | `app/components/SessionActionBar.tsx` | Lift adapted |
| `src/session-info-chips.jsx` (chip styling/animation) | `app/components/SourceInfoChip.tsx` | Lift inspired (relocated lower-right) |
| `src/screen-home.jsx` | `app/components/HomeScreen.tsx` | Lift adapted |

**Do NOT port**: `eagle-http-client.js`, `screen-class-setup.jsx`,
`item-mutations.js`, `use-delete-flow.js`, manage panel, ref-set mutators,
image-cache Eagle coupling.

### Layout
- **Timer** top-right, always visible (`mm:ss`, JetBrains Mono tabular-nums)
- **Progress bar** top edge, 4px, fills left→right
- **Image** `<img object-fit="contain">` at 100% viewport, `key={image_id}` for clean remount
- **Source-info chip** lower-right, semi-transparent panel
- **Action bar** centered at bottom, auto-hides
- **Edge-positioned Prev/Next arrows** absolute left/right

### Timer state machine
`useHighResTimer(durationMs, active, onTick, onEnd, resetKey)`:
- `performance.now()` + `requestAnimationFrame` loop, 60 Hz `onTick(elapsed)`
- Pause/resume via `active` boolean; accumulator preserves elapsed across pause
- `resetKey` change → reset accumulator + restart from 0

### Audio cues (Web Audio, procedural, no asset files)
- Singleton AudioContext + DynamicsCompressor in chain
- `ding()` — 880 Hz triangle + 1760 Hz sine, 0.55 s. Fires at halftime / 30 s / 10 s
- `countdown(step: 0 | 1 | 2)` — 660 / 784 / 988 Hz triangle. Last step adds 1976 Hz sine + longer duration. Fires at T-3 / T-2 / T-1
- `transition()` — 523.25 → 784 Hz triangle, ~0.43 s. Fires on every advance

### Chrome auto-hide
- 2000 ms `mousemove`-idle timer
- Cursor → `none` when hidden
- Force-show condition: report modal open
- All chrome elements (action bar, progress bar, source-info chip) fade
  together via opacity + translateY; eagle's `--timing-slow` (0.2 s)

### Keyboard shortcuts (window-level, gated by input-focus check)

| Key | Action |
|-----|--------|
| `←` `→` | prev / next |
| `Space` | pause / resume |
| `B` | toggle B&W (`filter: grayscale(1) contrast(1.05)`) |
| `Z` | cycle magnifier off → S → M → L → XL → off |
| `+` `-` `0` | zoom in / out / reset (range 0.25-4×, step 0.25) |
| `R` | open report modal |
| `Esc` | close modal if open, else exit session |

### Action bar (10 items)
Prev (edge) · Pause · Timer dropdown · B&W · Magnifier · Zoom reset · Report · Source-link · Counter (X/Y) · Next (edge). All except prev/next sit in a centered floating bar; prev/next are absolute-positioned edge buttons.

### Image preload
`lib/preload-manager.ts` keeps next 2 images warm via `new Image()` LRU
cache. Exposes `setQueue`, `onIndexChange`, `markUsed`, `cache.get(id)`.

### Image transitions
Hard cut (no cross-fade); `key={image_id}` forces remount. Zoom/pan reset
per slide; B&W and magnifier persist.

### End of session
When `idx + 1 >= items.length`: brief "Session complete — N images drawn"
overlay (fade in 0.3 s) with Back-to-home / Start-new-session buttons.
Auto-redirect to `/` after 15 s.

---

## 8. Home screen

Single column form, minimal (per user spec: no thumbnail strip).

### State (single client form)
- `intervalSec: number` — picked from chip group (30 / 60 / 120 / 180 / 300 / 600 / custom)
- `subjectType: 'nature' | 'specimen' | 'both'`
- `repeatMode: 'default' | 'never-repeat-animals' | 'allow-different-angles'`

### Submit
POST `/api/session/start` with the form state → server builds the pool
(filters + repeat-mode + report-exclusion via Drizzle) → stores in an
in-memory `Map<sessionId, items[]>` keyed by random UUID → returns
`{ sessionId }` → client `router.push('/session?session=' + sessionId)`.

In-memory pool is good enough for casual classroom use; survives a single
session, not across server restart. Can promote to a table later if needed.

---

## 9. Gallery

### Layout
- Top: SpeciesAutocomplete (port of `danbooru-uploader/TagAutocomplete.tsx`)
- Below: Subject-type chips (inline) + Institution multi-select popover
- Grid: 6-7 columns of 512px thumbnails with colored 4px left stripe per `taxon_order`
- Hover any tile → fixed-position 1024px medium preview (port of
  `deepagents-artist-tooling/HoverZoom.tsx`)
- Click tile → opens row's `image_url` in new tab (upstream source)

### Result ordering
Order by `collection_id, image_id` so same-collection tiles appear
adjacent. Each tile in a multi-image collection shows a "1/3" badge.

### Pagination
200 per page; "Load more" button at bottom; URL contains `?page=N`. 5092
images → 26 pages max.

### Streaming
`<Suspense>` wraps the grid; filter chips render immediately while the
Drizzle query resolves.

### Lazy loading
`<img loading="lazy">` on all tile elements.

### Autocomplete (FTS5)
- 200 ms debounce (TanStack React Query with AbortSignal)
- Tokenize input; last token gets `*` suffix for prefix match
- Query joins `images_fts` back to `images`, orders by `bm25(...)` then count
- Result rows: common name colored in `taxon_order` palette; scientific
  italic muted; count in mono

---

## 10. Report flow

### Submission (student side)
- Trigger: `R` key or Report button in session → `router.push('/report/' + imageId)`
- Modal pattern: `@modal/(.)report/[id]/page.tsx` intercepts the route,
  renders `<ReportForm>` inside `<Modal>` overlay on the session view
- Underlying session is paused; chrome force-shown while modal open
- Form: 5 preset chips (`low-resolution`, `spooky`, `cropped`,
  `ai-generated`, `other`); "other" reveals 250-char textarea
- Submit → `submitReport` Server Function → close modal via `router.back()`
- Toast: "Thanks — admin will review"

### Resolution (admin side, `/admin/reports`)
- Hidden URL + Basic Auth gate via `proxy.ts` + per-action re-verify
- Cards listed newest-first: thumbnail · image_id · category · message ·
  metadata · `[Dismiss]` `[Hide image]` `[Delete]`
- Actions:
  - `Dismiss` — `resolved_action='dismissed'`, image stays visible
  - `Hide image` — sets `images.hidden=true` + resolves all reports for it
  - `Delete` — destructive: removes files + DB row (cascade-deletes reports)
- Delete button uses inline confirm (morphs into red "Are you sure?")
- Empty state: "no pending reports — nice job, students 🌿"

### Server Function contract

```typescript
// actions/_invalidation.ts
const ON_REPORT_SUBMIT = ['reports','gallery-results','images-stats'];
const ON_DISMISS       = ['reports','gallery-results'];
const ON_HIDE          = ['reports','gallery-results','images-stats'];
const ON_DELETE        = ['reports','gallery-results','images-stats','species-index'];
```

Note: session pools are *not* cached via `'use cache'` — they live in the
in-memory `Map<sessionId, items[]>` inside `/api/session/start` and are
rebuilt fresh on each session-start (Drizzle query reads current `hidden`
state + active reports). No `session-pool` cache tag needed.

All admin Server Functions call `requireAdmin()` (re-reads
`Authorization` header, bcrypt-compares) before mutating.

---

## 11. Auth

**HTTP Basic Auth** for `/admin/*` and `/api/admin/*`. No login page,
no auth library, no DB sessions.

### `proxy.ts` (project root)
```typescript
import bcrypt from 'bcryptjs';
export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };

export function proxy(req: Request) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) return unauthorized();
  const [user, pass] = atob(auth.slice(6)).split(':');
  if (user !== 'admin') return unauthorized();
  if (!bcrypt.compareSync(pass, process.env.ADMIN_PASSWORD_HASH!)) return unauthorized();
}

function unauthorized() {
  return new Response('auth required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="line-of-bugs admin"' },
  });
}
```

### Defense in depth
Each admin Server Function calls `requireAdmin()` (re-verifies the header
via `next/headers`). proxy.ts alone is not sufficient per current Next.js
docs guidance.

### Discoverability
- No nav link to `/admin` anywhere
- `public/robots.txt` includes `Disallow: /admin/`
- Only accessible by knowing the URL

---

## 12. Styling system

### Palette
- Dark theme (port from eagle): `#0d0c10` base, `#16141a → #201e24`
  gradient, text alpha ladder 0.92 / 0.7 / 0.55
- Fonts: Zen Maru Gothic (sans), JetBrains Mono (mono — timer / counters /
  kbd hints), Fraunces (display — sparing)
- 4px spacing grid (s1=2…s12=24); radius tiers 4 / 6 / 10 / 14
- Transition timing: 0.12s fast / 0.15s base / 0.2s slow
- Dual-ring focus indicators; backdrop-blur on floating panels

### Insect-order accent palette ("Pastel Goth Kawaii")
Locked after deep cute-color research (see `ui-spec.md` and
`previews/palette.html`):

```typescript
// lib/order-colors.ts
export const orderColors: Record<string, string> = {
  Coleoptera: '#FF6EC7',  Lepidoptera: '#F8B4D9',  Hymenoptera: '#FFD166',
  Hemiptera:  '#E16AAA',  Diptera:     '#A78BFA',  Odonata:     '#67D4E6',
  Orthoptera: '#A8E6A1',  Mantodea:    '#7FD89A',  Neuroptera:  '#D4C5F9',
  Blattodea:  '#9C8AAC',  Dermaptera:  '#C9A8D4',  Phasmatodea: '#B8D898',
  Trichoptera:'#E8A8D4',  Ephemeroptera:'#F0D796', Plecoptera:  '#88B8D4',
  Isoptera:   '#A89684',  Other:       '#B8B0C4',
};
```

Used in: autocomplete result name color, gallery tile stripe, source-info
chip dot.

---

## 13. Caching strategy

Three layers:

1. **Browser / CDN** — `Cache-Control: public, max-age=31536000, immutable`
   on `/api/img/*`, `/api/medium/*`, `/api/thumb/*`
2. **Next.js Cache Components** (`'use cache'` + `cacheLife` + `cacheTag`)
   — server-side, cross-request. Invalidated by Server Functions via
   `revalidateTag`.
3. **React `cache()`** — per-render dedup inside RSC

### Cache tags + invalidation (single source of truth)

| Tag | Set by | Invalidated by |
|-----|--------|-----------------|
| `images-stats` | `getImageStats`, `listSubjectTypeCounts` | `submitReport`, `hideImage`, `deleteImage` |
| `gallery-results` | `searchGallery` | all mutations |
| `species-index` | `searchSpecies` | `deleteImage` only |
| `institutions` | `listInstitutions` | rare; no current mutation |
| `reports` | `getPendingReports`, `getPendingCount` | all mutations |

(Session pools are in-memory per `/api/session/start` call, not in the
Next.js cache; built fresh from current DB state each call, no tag needed.)

`cacheLife` choices: `'minutes'` for reports queue, `'hours'` for gallery
results + autocomplete, `'days'` for institutions + stats.

---

## 14. Performance

Estimated for ~50 concurrent classroom users:

| Metric | Estimate |
|--------|----------|
| Node memory at idle | ~180 MB |
| Drizzle query latency | sub-ms (5K-row DB fits in OS page cache) |
| FTS5 autocomplete query | 1-3 ms |
| Image stream (server-side) | ~5 ms first byte locally |
| CPU at peak | <10% per vCPU |
| Bandwidth per active user-hour | ~75-90 MB |
| Disk | ~8 GB after medium tier + 5 MB SQLite |

### Specific optimizations in scope
- `<img loading="lazy">` on gallery tiles
- React `cache()` for queries called from multiple components per render
- `ANALYZE` in seed for query-planner statistics
- 200 ms debounce + AbortSignal on autocomplete
- PreloadManager keeps next 2 session images warm
- Hover-intent on HoverZoom (medium not loaded until intent)

### Out of scope (over-extreme)
Service worker, prefetch hints, HTTP/2 push, on-the-fly image
transcoding, CDN tier. All addable later without app changes.

---

## 15. Deployment notes

- Target: VPS with HAProxy in front of Node
- nginx tier not required for MVP (can add later if image-serving load
  warrants it)
- `data/` directory mounted outside the build (gitignored; populated by
  the Python downloader scripts)
- `.env.local` must contain `ADMIN_PASSWORD_HASH` (bcrypt) +
  `SKETCHFAB_API_KEY` (deferred but stored)
- Node 24 LTS pinned via `.nvmrc`

---

## 16. Vocabulary

Aligned with `eagle-gesture-drawing`:
- **Session** — single drawing run, started from Home, ended by Esc
- **Session player / session view** — fullscreen rendering UI during a session
- **Slide** — one image displayed for one timer interval
- **Chrome** — auto-hiding UI (action bar + source-info chip)
- **Item / image** — single image record from the manifest
- **Collection** — group of images sharing a `collection_id`

---

## 17. Build sequence (for the implementation phase)

Suggested order, since some pieces depend on others:

1. **Scaffold Next.js 16 + TypeScript** at project root (alongside existing
   `db/`, `drizzle/`, `scripts/`)
2. **Port eagle design tokens** → `lib/tokens.ts` + `app/globals.css`
3. **Port fonts** → root layout via `next/font/google`
4. **DB schema additions** → `images.hidden` column + 0001_fts5 migration
5. **Route handlers**: `/api/img`, `/api/medium`, `/api/thumb`
6. **Port audio + timer hook** → `lib/audio.ts` + `lib/hooks/useHighResTimer.ts`
7. **Port PreloadManager** → `lib/preload-manager.ts`
8. **Home screen** + `/api/session/start` route
9. **Session player** with action bar + source-info chip
10. **Gallery page** with FTS5 autocomplete + hover-zoom + grid + filters
11. **Report flow**: modal pattern + `submitReport` Server Function
12. **Admin reports view** + `proxy.ts` Basic Auth
13. **Server Function suite**: `dismissReport`, `hideImage`, `deleteImage`
14. **End-of-session overlay**
15. **Polish**: animations, lazy loading, ANALYZE, README

---

## 18. Open questions (post-approval)

- ~~`drizzle-kit push` vs `generate + migrate`~~ — **`generate + migrate`
  stays** (user decision 2026-05-14). Migration files are version-controlled
  history.
- **Color palette implementation tweak** — `Candidate B (Pastel Goth Kawaii)`
  locked, but we may adjust 1-2 specific hex codes once we see the
  autocomplete + tile stripe at real-rendered scale. Easy to tweak (one
  file: `lib/order-colors.ts`).

Everything else from the conversation captured in `docs/ui-spec.md` is
locked or out-of-scope (`docs/sketchfab-notes.md`).

---

*End of design spec.*
