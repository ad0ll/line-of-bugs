# line-of-bugs — UI Specs (as provided by the user)

> This document is a capture of everything the user has said about the UI/UX
> throughout the conversation thread that started 2026-05-14. It uses direct
> quotes (in italic blockquotes) wherever possible so we can verify alignment
> before brainstorming locks the design.

## 0. Project north star

> *"This project will eventually be a gesture/figure drawing app like line of
> action, but everything will be bugs."*

> *"This app will be a vastly reduced feature set as it's made to be served
> on a webapp for other students, and eagle-gesture-drawing is so extremely
> specific to figure drawing and my own personal workflow."*

> *"This ap is not based on eagle, it'll be deployed to a vps and be
> filesystem based."*

> *"Performance and simple animations (no going overboard) are important, the
> app should look and feel good."*

- Subject pool: **insects only — NO spiders**, no arachnids/mites/centipedes.
- All images must show a **single, clear subject** (added later — see §8).

## 1. Tech direction

Locked in:

> *"NextJS should be fine for React framework."*

> *"You can install typescript + dependencies as needed."*

> *"We just have to get things in sqlite + drizzle I think."* — 2026-05-14

- Framework: **Next.js 16.x** (TypeScript), **app router**.
- **Filesystem-based** image storage (not Eagle-DB-based, not S3, just files on the VPS).
- **SQLite** for `images`, `reports`. Admin auth is stateless signed cookies — no DB table.
- **Drizzle ORM** (`drizzle({ client: sqlite, schema })` object form per current docs).
- **`serverExternalPackages: ['better-sqlite3']`** in `next.config.ts` to keep
  Webpack/Turbopack from trying to bundle the native binding.
- **HMR-safe singleton** for the SQLite handle via `globalThis` guard in
  non-production builds (eliminates file-handle leakage on dev edits — same
  Prisma-style pattern, not strictly required by Drizzle but cheap insurance).
- **Cache Components** opt-in (`cacheComponents: true` in next.config.ts) +
  the `'use cache'` directive with `cacheLife` / `cacheTag` / `updateTag`
  for Drizzle query caching. This is the modern caching model in Next 16;
  `unstable_cache` is being superseded.
- **Auth**: **HTTP Basic Auth** via `proxy.ts` — verified against an
  env-var bcrypt hash (`ADMIN_PASSWORD_HASH`). Browser handles the credential
  prompt natively; no login page to build. Admin Server Functions
  *re-verify* the Authorization header before mutating (defense in depth,
  per Next.js docs guidance).
- **Admin page is unlinked** — security-by-obscurity:
  - No "Admin" link in nav / footer / any user-facing page
  - `robots.txt` Disallow `/admin/`
  - Only accessible by knowing the URL `/admin/reports`
  - Plus Basic Auth gate via `proxy.ts`
- **Image serving**: `app/api/img/[name]/route.ts` + `app/api/thumb/[name]/route.ts`
  (streaming Route Handlers — see §4b below).
- **Styling**: lift from `/Users/adoll/projects/eagle-gesture-drawing` —
  see §2. CSS approach matches eagle (CSS custom properties in `globals.css`
  + ported `designTokens.ts` for inline-style consumers).

Sources for the Next.js 16-specific decisions:
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy (renamed
  from `middleware.ts`)
- https://nextjs.org/docs/app/getting-started/caching (Cache Components +
  `'use cache'`)
- https://nextjs.org/docs/app/getting-started/mutating-data (Server
  Functions — formerly "Server Actions")
- https://orm.drizzle.team/docs/connect-better-sqlite3 (object-form init)

## 2. Visual influence — eagle-gesture-drawing (port list)

> *"~/projects/eagle-gesture-drawing is quite elegant and is a similar app
> to this one. We wouldn't have all the features that one has as its
> purpose built for my specific workflow, but I think you can lift some of
> the styling and css from there, especially for the action bar, timer,
> and timer progress bar, as well as quickly rendering images, keyboard
> navigation, and starting a session."* — 2026-05-14

Concrete lift list (from agent investigation 2026-05-14):

| eagle file | Status | Target in line-of-bugs |
|---|---|---|
| `src/design-tokens.js` | **Lift verbatim** (port to TS) | `lib/tokens/designTokens.ts` |
| `assets/styles.css` (`:root` + utilities) | **Lift verbatim** | `app/globals.css` |
| `src/audio-cues.js` (Web Audio procedural) | **Lift verbatim** | `lib/audio/cues.ts` |
| `src/timer-hook.jsx` (`performance.now()` + rAF) | **Lift verbatim** | `lib/hooks/useHighResTimer.ts` |
| `src/screen-home.jsx` | **Lift adapted** (remove Eagle folder/class logic) | `app/components/HomeScreen.tsx` |
| `src/session-action-bar.jsx` (`IconBtn` primitive) | **Lift adapted** (remove Manage/Swap icons; add Report + ExternalLink) | `app/components/SessionActionBar.tsx` |
| `src/session-info-chips.jsx` | **Lift inspired** (relocate to lower-right; replace folder chips w/ license/source/author/institution) | `app/components/SourceInfoChip.tsx` |
| `src/screen-session.jsx` | **Lift core parts** (timer state machine, chrome-hide 2s idle, keyboard handler) | `app/components/SessionPlayer.tsx` |

**Skip / out of scope** (eagle-specific, do NOT port):
`eagle-http-client.js`, `screen-class-setup.jsx`, `item-mutations.js`,
`use-delete-flow.js`, manage panel, ref-set mutators, image-cache Eagle
coupling.

Style markers (already exhaustively documented in agent report; key points):
- Surfaces: `#0d0c10` base; `#16141a → #201e24` gradient.
- Text alpha ladder: 0.92 / 0.7 / 0.55 (WCAG AA floor).
- Fonts (Google Fonts, imported via `next/font/google`):
  - **Zen Maru Gothic** (sans)
  - **JetBrains Mono** (mono — timer, dimensions, kbd hints)
  - **Fraunces** (display serif, sparing)
- 4 px spacing grid (s1=2 … s12=24); border radius tiers 4 / 6 / 10 / 14.
- Transition timing: 0.12s fast / 0.15s base / 0.2s slow.
- Dual-ring focus indicators; backdrop-blur on floating panels.
- Image rendering: `<img object-fit="contain">` (no canvas, no preload chain).
- Keyboard handler: **window-level** `keydown`; ignores if input/textarea
  has focus.

## 2b. Gallery references (port list)

- **Hover-enlarge preview** — `/Users/adoll/projects/deepagents-artist-tooling/apps/frontend/components/HoverZoom.tsx`:
  > *"the hover to view enlarged image logic in ~/deepagents-artist-tooling"*
  - React 19 + plain CSS, zero external deps.
  - 1024 px max-dim; opacity-fade 150 ms; viewport-clamped positioning.
  - Hover-only (no keyboard), lazy image load on hover-intent.
  - Lift **verbatim** with `imageUrl()` builder adjustment.

- **Species autocomplete** — `/Users/adoll/projects/danbooru-uploader/src/frontend/TagAutocomplete.tsx`:
  > *"~/danbooru-uploader has an amazing autocomplete for booru tags that
  > has logic + design that could be lifted into this app too."*
  - React 19 + TS + TanStack React Query + AbortSignal cancellation.
  - 200 ms manual debounce; ARIA combobox + listbox semantics.
  - Replace backend with Next.js API route hitting Drizzle/SQLite
    `species` table.
  - Keyboard nav: ↑/↓ skip-disabled, Enter select, Esc close.
  - Category colors per tag-type (we'll have insect-order colors instead).

## 3. Home screen

> *"Student will have a home page and they will be able to pick from 30s,
> 60s, 2m, 3m, 5m, 10m or custom time per slide…"*

- Pick interval per slide: **30s / 60s / 2m / 3m / 5m / 10m / custom**.
- Pick subject-type filter — *added later*:
  > *"Specimen and nature photos are okay. Go ahead and record metadata
  > about whether a photo is specimen or nature or not, and then we'll let
  > the user select to include specimens, nature, or both (like how line of
  > action lets you select male female teenager all) when we get there."*
  - Subject-type values (R4+): `wild` | `captive` | `specimen` | all.
    The DB column is `subject_state` (DwC-aligned); the UI label is still
    "subject type" to match the user's vocabulary.
- "Proceed" advances to the render window.

### R6 (2026-05-15): "what kind of bug?" + "more filters"

Two collapsible sections sit between subject type and Proceed:

- **what kind of bug?** — 21-chip multi-select keyed to
  `lib/taxonomy.ts:TAXON_GROUPS` (butterflies / moths / caterpillars /
  ladybugs / beetles / bees / wasps / ants / flies / mosquitoes /
  dragonflies / grasshoppers / crickets / mantises / stick insects /
  cockroaches / stink bugs / cicadas / aphids / earwigs / weird stuff).
  Empty selection means "all bugs". Chips with ambiguous coverage carry
  a tooltip surfaced via `<Tooltip>` on hover *and* keyboard focus.
- **more filters** — view / life-stage / sex pickers (same picker
  component the gallery uses).

Both sections collapse by default with a "(N selected)" badge on the
chevron header, and the live total-image count below them updates as
filters change.

## 3b. Vocabulary alignment with eagle-gesture-drawing

> *"let's align on vocab. Vocab from eagle-gesture-drawing can be lifted
> and used here. When you say session view, you mean when we start drawing
> images?"* — 2026-05-14

- **Session**: a single drawing run, started from Home, ends on Esc.
- **Session player / session view**: the fullscreen rendering UI during a
  session (timer + progress bar + image + action bar + source-info chip).
- **Slide**: one image displayed for one timer interval inside a session.
- **Chrome**: the auto-hiding UI elements (action bar + source-info chip).
  Chrome reveals on mousemove, hides after 2 s idle.
- **Item / image**: a single image record from the manifest.
- **Collection**: a group of images sharing a `collection_id` (e.g., the
  4 angles of one Acalolepta beetle specimen on Bugwood).

## 4b. Image serving (three tiers, EU-latency conscious)

Three "sizes" pre-baked on disk by the download scripts (inline, no
post-hoc pass):
- **Full-size** — `data/images/<name>.jpg`, ~0.25-8 MB, avg ~1.2 MB. The
  original we downloaded.
- **Medium (1024px)** — `data/medium/<name>.jpg`, 1024 max edge, ~130 KB
  avg, JPEG q88. Added 2026-05-14 specifically for EU server latency
  (~150 ms RTT × ~10 hovers = noticeable). Saves ~1 MB per hover.
- **Thumbnail (512px)** — `data/thumbnails/<name>.jpg`, ~70 KB, JPEG q85.

Three Route Handlers (Next.js 16 — chosen because they expose Web Streams
API, needed for chunked file serving):

```typescript
// app/api/img/[name]/route.ts
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const safe = name.replace(/[^a-z0-9_.-]/gi, '');  // path-traversal guard
  const filePath = path.join(process.cwd(), 'data', 'images', safe);
  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
```

(Mirror for `/api/thumb/[name]/route.ts` → `data/thumbnails/`, and
`/api/medium/[name]/route.ts` → `data/medium/`.)

**Where each tier is used:**
- **Session/practice view** — `<img src="/api/img/<name>">`, `object-fit: contain`,
  fullscreen. Full-size, full quality — this is the actual subject for drawing.
- **Gallery thumbnail grid** — `<img src="/api/thumb/<name>">` (~70 KB per tile, snappy).
- **Gallery hover preview** — `<img src="/api/medium/<name>">` (~130 KB),
  displayed via CSS `max-width: 1024px; max-height: 1024px; object-fit: contain`.
  ~8× smaller download than full-size, important for EU-served deployment.
- **Click in gallery → new tab** — opens the row's `image_url` field (the
  source CDN URL, e.g. iNat S3 or Bugwood). User clarification 2026-05-14:
  *"Open image source url in tab so the user can see the original full scale
  image (we'll likely served compressed images on the website)"*. No serving
  from us; the source has the original.

**Disk impact of three tiers** (5092 images, validated):
- full: 6.36 GB · medium: 0.67 GB · thumb: 0.18 GB · SQLite: 5.2 MB
- Total: ~7.2 GB. At 50K image scale, project to ~70 GB.

**Why route handlers, not `next/image`:**
- `next/image` requires `images.localPatterns: [{ pathname: '/api/img/**' }]`
  config + adds the Sharp native dep (~30-50 MB), plus writes optimized
  variants to `.next/cache/images` (potentially several GB for 5K-50K source
  images × default device-size variants).
- We already have the variants we need pre-baked.
- Plain `<img>` + immutable Cache-Control is the lighter, correct call.

**Why not symlink to `public/`:**
- Next.js copies `public/` into the build output; 5K-50K files would slow
  builds and bloat the artifact.
- `data/` stays gitignored and outside the build entirely with route handlers.
- nginx/HAProxy can still bypass-Node-cache us via CDN headers (immutable).

## 4. Session / render screen

> *"When they proceed they will be taken to the main render window where
> the picture of the bug will be rendered w/ a timer in the top right and a
> progress bar across the top."*

Layout:
- **Timer**: top-right, always visible (eagle pattern: `mm:ss`, JetBrains
  Mono, tabular-nums). Always visible — does NOT auto-hide.
- **Progress bar**: top edge, 4px height, fills left→right; transition
  `0.1s linear` when playing, removed when paused.
- **Image**: `<img object-fit="contain">` at 100% viewport.
- **Source-info chip**: lower-right (our adaptation; eagle uses top-left
  with different content). Shows photographer · license · institution +
  link to source page. Visibility tied to `chromeVisible`.

### Image preload (port from eagle's PreloadManager pattern)

`lib/preload-manager.ts` — separate module, owns:
- `setQueue(items: Image[])` — called when session pool is set
- `onIndexChange(idx: number)` — called on advance
- `markUsed(id: string)` — touches LRU on render
- `.cache.get(id) → { status: 'ok' | 'loading' | 'error', img?: HTMLImageElement }`

Behavior: keeps next 2 image elements in cache via `new Image(); img.src = …`;
evicts old ones beyond the LRU window. Provides "broken image" detection
for the renderer (so we can skip a 404'd image gracefully).

Sound cues — verbatim port from `eagle/src/audio-cues.js` (verified
2026-05-14, exact frequencies + durations from source).

> *"A sound will play at half time, 30s, 10s, and then 3, 2, 1."*

API surface to port to `lib/audio.ts`:

```typescript
export function makeAudio(): {
  ding: () => void;                     // 880 Hz triangle + 1760 Hz sine octave
                                        //   triangle vol 0.55, sine vol 0.165
                                        //   5 ms attack, 30 ms hold, 0.55 s tail
                                        //   used for: halftime, 30 s, 10 s
  countdown: (step: 0 | 1 | 2) => void; // T-3 / T-2 / T-1
                                        //   step 0: 660 Hz triangle, 0.18 s, vol 0.45
                                        //   step 1: 784 Hz triangle, 0.18 s, vol 0.45
                                        //   step 2: 988 Hz triangle + 1976 Hz sine,
                                        //           0.35 s, vol 0.6 + 0.18 (bigger
                                        //           final beat)
  transition: () => void;               // advance ding: C5→G5 rise, ~0.43 s
                                        //   note 1: 523.25 Hz triangle, 0.18 s, vol 0.40
                                        //   note 2: 784 Hz triangle, 0.25 s, vol 0.45
};
```

Implementation notes (also from eagle):
- Singleton AudioContext, created lazily on first cue, reused.
- DynamicsCompressor in the output chain: threshold -12 dB, knee 6,
  ratio 4, attack 3 ms, release 150 ms. Catches overlapping cues.
- All envelopes are 5 ms attack → 30 ms hold → exponential decay.
- Layered cues use a triangle root + sine octave (1.5× higher freq + lower
  vol) for warmth.

Trigger logic lives in `SessionPlayer`'s `onTick(elapsed)` callback — the
hook itself doesn't emit cues. Per-slide flag tracks "already fired" so
each cue fires once per slide:

- `elapsed >= durationMs / 2` → `ding()` (only if duration ≥ 60 s; on a
  30-s session there's no half-time cue separate from the 30-s mark)
- `remaining ≤ 30_000` → `ding()`
- `remaining ≤ 10_000` → `ding()`
- `remaining ≤ 3_000` → `countdown(0)`
- `remaining ≤ 2_000` → `countdown(1)`
- `remaining ≤ 1_000` → `countdown(2)`
- On advance (auto or manual) → `transition()`

Image selection:

> *"Bug images will be served randomly. You should never see the same bug
> twice in a session…"*

- Random order across the eligible image pool.
- Pool is built at session start from the filters chosen on Home (see §3).
- Two **repeat-control toggles** on the Home screen (2026-05-14 spec
  addition):
  - **"Never repeat animals"** — best-effort dedup by *species*. For each
    distinct `(taxon_species OR common_name)` we pick **one** random image
    from the source pool. Reduces pool size; OK because the library will
    eventually reach 20-50K images.
  - **"Allow same animal from different angles"** — group by
    `collection_id` rather than species; each collection contributes its
    full set of angles. Useful for multi-view study.
  - These two are mutually exclusive (radio-style). A third value
    "everything" is the default — full pool, no dedup.
- Within the chosen pool the order is fully randomized; we don't repeat an
  image within a single session.

## 5. Action bar (final, after deep eagle research 2026-05-14)

> *"There will be an action bar at the bottom that will let you move backward
> one image, forward one image, or pause. You will also be able to move
> backwards, forward, and pause with left, right, and space. Action bar
> will be hidden unless you move your mouse."*

Auto-hide after **2000 ms** of `mousemove`-idle (eagle confirmed value, only
`mousemove` triggers reveal, no keydown). Cursor → `none` while hidden.
Force-show condition: chrome stays visible when the report modal is open
(equivalent to eagle's "manage panel open" guard).

### Layout
- **Edge-positioned Prev (left) and Next (right)** buttons — absolute, large
  click targets, eagle-style. Tablet/touch-friendly.
- **Centered bottom bar** with 8 actions in this order: Pause • Timer
  dropdown • B&W • Magnifier • Zoom reset • Report • Open source • Counter (X/Y)
- Plus **Exit** as an Esc-only keyboard shortcut (or top-right corner if we want a visible button).

### Keyboard shortcuts (final, after eagle research)

| Key | Action |
|-----|--------|
| `←` | Previous image |
| `→` | Next image |
| `Space` | Pause / resume |
| `B` | Toggle B&W filter |
| `Z` | Cycle magnifier size off → S → M → L → XL → off |
| `+` / `=` | Whole-image zoom in (step 0.25, max 4×) |
| `-` / `_` | Whole-image zoom out (min 0.25×) |
| `0` | Reset whole-image zoom |
| `R` | Open report modal |
| `Esc` | Close modal if open, else exit session |

All shortcuts are gated: ignored when an `<input>` / `<textarea>` /
`contenteditable` has focus (e.g., the report-modal textarea).

### Drawing-reference tools (ported from eagle)

These came up in the deep code review — they're not Eagle-specific plumbing,
they're genuinely useful drawing-study features that students will want.
All confirmed in scope 2026-05-14.

- **B&W toggle**: `filter: grayscale(1) contrast(1.05)` on the `<img>`.
  Values-only study without color distraction. Toggle via button or `B`.
- **Magnifier (loupe)**: cursor-following rectangular zoom @ 3×. Sizes
  S/M/L/XL = area fractions 1/8, 1/4, 1/3, 1/2 of viewport. Aspect mirrors
  the underlying image. Click action-bar button to cycle, right-click for
  size picker; `Z` key cycles.
- **Whole-image zoom**: `transform: scale(imgZoom)` on the `<img>`, range
  0.25-4× in 0.25 steps. Drag-to-pan when `imgZoom > 1`. Resets on advance.
  Keys `+`/`-`/`0`.
- **No cross-fade between slides**: hard-cut on advance (eagle matches —
  the `<img>` src just changes; React `key={image_id}` to force remount and
  clean state).

### Image transitions

- **Hard cut**, no cross-fade — confirmed 2026-05-14.
- Per-slide state reset: zoom → 1, pan → (0,0), magnifier stays at chosen size,
  B&W stays on if toggled.

### Out of scope / dropped from eagle

- Manage panel, Delete dialog, Swap (class mode), Eagle-open button — all
  Eagle library plumbing.
- Custom class presets — would be a separate future feature.

### Bonus: external-source link
- **Open source in new tab** action — opens `source_page_url` (the
  observation/specimen page on iNat/Bugwood/Smithsonian/etc., not the CDN
  image URL).

### Bonus: end-of-session overlay (our addition)

When the queue runs out (`idx + 1 >= items.length`):
- Brief "Session complete — N images drawn" overlay on top of last image
  (fade in over 0.3 s)
- Two buttons: **Back to home** / **Start new session (same settings)**
- Auto-redirect to `/` after 15 s if no interaction
- Audio: final `transition` ding plays as usual (treat last advance the
  same as any other)

### ~~Sketchfab button~~ — *deferred per user (2026-05-14)*

> *"Sketchfab button, out of scope for right now, we'll come back to this
> after we have the basic app working."*

Notes moved to [`docs/sketchfab-notes.md`](./sketchfab-notes.md). API key
already in `.env.local`.

## 6. Source-info box (lower-right when action bar reveals)

> *"When the action bar appears after moving your mouse, we should show a
> box in the lower right hand corner that's semi-transparent that shows all
> of the meaningful source information we have, the license, source url,
> author, institution, if it's available."*

- Triggered together with the action bar reveal (same chrome-hide group).
- Semi-transparent panel (eagle `surfaceChipStrong` 0.78 alpha pattern).
- Fields shown when present: **license, source URL (linked), author,
  institution.**
- License doesn't need its own prominent display in-app (per §10) but is
  recorded for pruning later.

## 7. Report flow

> *"The action bar will also have a report button that will let the user
> type a message reporting that an image shouldn't be included w/ some
> preset chips for 'low resolution' 'spooky' 'cropped' 'ai generated'
> 'other', text box displays w/ max 250 chars when you click other which
> store a record in an sqlite database for feedback to view later."*

- Report button on action bar (button #4).
- Preset chips: **low resolution, spooky, cropped, ai generated, other**.
- Clicking **other** reveals a textarea, **max 250 chars**.
- Report submission → SQLite `reports` table.

> *"Reported images can then be hidden from users until an admin has cleared
> them (we'll need an admin page w/ password auth that's hidden from the
> user to view reports)"*

- An image with an unresolved report is **hidden from regular users**
  (excluded from session randomization).
- Admin page (hidden, password-protected) lists pending reports; admin can
  dismiss / mark image hidden / etc.

## 8. Single-subject constraint (curation rule)

> *"One new requirement for downloading, all images should only contain one
> bug, so no mating/colonies and such, it should be a clear single subject."*

- All curated images must show **a single clear subject**.
- No mating shots, no colonies, no swarms.
- Enforcement happens at *download/curation* time (filters on iNat
  observation fields, Bugwood `descriptor` field, etc.), and at runtime via
  the report-button safety net.
- The user has explicitly said **no ML classifier** for this — pure metadata
  filtering. *"A classifier for this project is overkill. Labelling is just
  best effort. If it's present or obvious in the filename we can include it,
  if it isn't we don't."*

## 9. Gallery view (added later, before UI brainstorm)

> *"For all images we download, store a compressed thumbnail version (will
> need to add this to metadata) in 512x512 jpeg quality 85."*

- **Thumbnail format: 512×512 JPEG q85.** Stored per image; filename
  recorded in manifest/db.
- Thumbnail generation happens **inline during the download script**, not
  as a separate post-hoc pass. *(user direction: "you probably want to
  prepare thumbnail in download scripts. Think deeply about how to organize
  this.")*

Gallery page:

> *"Have a gallery page that lets you search the collection by bug type,
> institution, specimen_type… Species type can be an autocomplete.
> Institution and specimen type can be filters at the top that are
> checkboxes. The search bar for animal type can be an autocomplete that
> hits the sqlite database (or maybe we need a backend that hits the sqlite
> database). We'll need to store the data for the images in a database,
> probably sqlite is fine."*

- **Filters at top of gallery**:
  - **Bug type** search bar — autocomplete, hits SQLite (likely via Next.js
    server component or API route).
  - **Institution** — checkbox list.
  - **Subject type** (UI label preserved from the user; DB column is
    `subject_state` per DwC `basisOfRecord` alignment) — checkbox list
    with values `wild` / `captive` / `specimen`.
  - **What kind of bug?** (R6) — 21-chip layperson taxonomy filter
    (`lib/taxonomy.ts:TAXON_GROUPS`), same chip wall used on Home.
  - **More filters** — view label, life stage, sex (R4 metadata).
- Inspiration:
  > *"We have a really elegant tag search solution in /booru-tag-lookup
  > that could be an inspiration for design on the filter by type."*

- **Results display**:
  > *"When the person selects something to search, you can show all the
  > images we have of that insect type as thumbnails, letting the user hover
  > over them to see a larger 1024 max dim preserve aspect ratio zoom in,
  > and when they click, it can open the image url in a new tab for the
  > user."*
  - Grid of 512×512 thumbnails.
  - **Hover**: enlarged preview, max-dim 1024 px, **preserve aspect ratio**.
  - **Click**: opens the **source image URL** in a new tab — user
    clarification 2026-05-14: *"Open image source url in tab so the user
    can see the original full scale image (we'll likely served compressed
    images on the website)"*. In manifest terms: open
    `image_url` (the CDN/source URL we fetched from), not
    `source_page_url`. The source page link is in the source-info chip on
    the session view.
  - Hover-behavior inspiration:
    > *"You can look at ~/deepagents-artist-tooling for inspiration for
    > this hover behavior."*

- **Collection grouping**:
  > *"One note, where possible, if the images are a part of a collection,
  > we're going to want to try to group them together whenever possible. Do
  > any of the places we're downloading from have a group identifier or a
  > collection identifier we can add to metadata? If we can't rely on the
  > collection identifier, we'll want to download…"*
  - The user wants images that are part of a **single-specimen multi-angle
    series** (e.g., dorsal/lateral/ventral of the same beetle) grouped
    together in the gallery.
  - Schema field: `collection_id` per image.
  - Per-source strategy still being verified — see "Open research items"
    below.

## 10. Display / attribution policy

> *"We're not going to monetize right now, so you can include it [CC-BY-NC].
> Just make sure to record licensing information in metadata storage (we
> need to attribute in the app regardless, don't need to display the license
> but should display the source url when we can) so we can prune later if
> we do modify"*

- In-app display: **attribution string + source URL** (don't need license
  text shown).
- Manifest/db: **record full license metadata** (SPDX-style code + URL) so
  we can prune NC content if the project goes commercial.

## 11. Filename convention (server-side files)

> *"Filenames stored on the server can be
> <id>_<source_name>_<subject_type>_<common-name>
> -> convert anything with spaces to use hyphens and all lowercase instead"*

- Format: `{source_id}_{source}_{subject_type}_{name-slug}.jpg`
- Slug rules: lowercase; spaces → hyphens; strip punctuation; fall back to
  the first two words of the scientific name if no common name; if both
  empty, drop the trailing segment.
- Examples:
  - `20362_inaturalist_wild_large-skipper.jpg`
  - `5544659_bugwood_specimen_bean-weevil.jpg`
  - (Subject-state slug was `nature` pre-R4; renamed to `wild` / `captive` / `specimen` to match DwC `basisOfRecord`.)

## 12. Performance + animation tone

> *"Performance and simple animations (no going overboard) are important, the
> app should look and feel good."*

- Animations: chrome auto-hide, image cross-fade on advance, subtle
  transitions on focus/hover. **No flashy/parallax/scroll-driven effects.**
- Performance: preload the next 1-2 images during a session so the next
  advance is instant.

## 12a. Next.js 16 conventions to use (verified 2026-05-14)

Updated from earlier draft after the user pushed back on a too-fast
architecture pass — the current docs are 16.2.x and several patterns I
remembered from 15.x are deprecated.

**Renamed: `middleware.ts` → `proxy.ts`** at project root.

> *"The middleware file convention is deprecated and has been renamed to
> proxy."* — https://nextjs.org/docs/app/api-reference/file-conventions/proxy

```typescript
// proxy.ts — HTTP Basic Auth (zero login UI; browser handles prompt)
import bcrypt from 'bcryptjs';

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };

export function proxy(req: Request) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) return unauthorized();
  const [user, pass] = atob(auth.slice(6)).split(':');
  if (user !== 'admin' || !bcrypt.compareSync(pass, process.env.ADMIN_PASSWORD_HASH!)) {
    return unauthorized();
  }
}

function unauthorized() {
  return new Response('auth required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="line-of-bugs admin"' },
  });
}
```

The docs stress: **proxy alone is not sufficient.** Each admin Server
Function re-verifies the `Authorization` header before mutating — defense
in depth.

Also: `public/robots.txt` includes `Disallow: /admin/` so the page isn't
indexed. Admin page has no inbound links from regular user UI — discoverable
only by knowing the URL.

**Caching: `cacheComponents: true` + `'use cache'`.** For Drizzle queries:

```typescript
import { cacheLife, cacheTag } from 'next/cache';

export async function getSpeciesAutocomplete(prefix: string) {
  'use cache';
  cacheLife('hours');
  cacheTag('species');
  return db.select(...).from(images).where(...);
}
// In a Server Function that resolves a report:
import { updateTag } from 'next/cache';
updateTag('species');  // invalidates the cache
```

For request-scoped dedup (one render pass, multiple components using the
same query), use React's `cache()`. Combine: `cache()` for per-render
dedup, `'use cache'` for cross-request caching.

**Modal pattern: parallel routes + intercepting routes.** For the "report
this image" modal that overlays the session/gallery view, the docs'
canonical recipe:

```
app/
├── @modal/
│   ├── default.tsx                 # returns null when slot is inactive
│   └── (.)report/[id]/page.tsx     # intercepting: shows modal over current view
├── report/[id]/page.tsx            # full page for direct-URL hit + refresh
└── layout.tsx                      # renders {children} + {modal}
```

Why this over plain React state: the modal becomes URL-shareable, refresh-
persistent, closes on browser back, reopens on forward. Source:
https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes

**Streaming the gallery grid.** Wrap the grid in `<Suspense>` and use a
`loading.tsx` for the route shell. First paint = filters + search bar
visible; grid streams in once Drizzle query resolves. Source:
https://nextjs.org/docs/app/api-reference/file-conventions/loading

**Fonts via `next/font/google`** — self-hosts automatically (no Google CDN
runtime path). All three of our fonts (Zen_Maru_Gothic, JetBrains_Mono,
Fraunces) confirmed available.

**Server Functions vs Route Handlers** — chosen split:
- Server Functions (mutations): `submitReport`, `adminLogin`, `adminLogout`,
  `resolveReport`. Form-driven, POST, integrate with `revalidatePath` /
  `updateTag`.
- Route Handlers (streams + non-POST): `/api/img/*`, `/api/thumb/*`,
  `/api/species/search?q=...` (GET for autocomplete), `/api/session/start`
  (POST returning the randomized queue; could be a Server Function but a
  route handler is cleaner for the client-fetch pattern).

## 12b. SQLite ingestion (fetcher → database)

Per user direction 2026-05-14: *"We just have to get things in sqlite +
drizzle I think."*

**R5 update (2026-05-15):** the CSV intermediate was removed. The four
Python fetchers now write directly to SQLite via `scripts/db.py:DbWriter`
— same `.has()` / `.write()` / `.count()` interface as the legacy
ManifestWriter, backed by `sqlite3.connect()` + `INSERT … ON CONFLICT
DO UPDATE`. No CSV files, no seed step.

### Drizzle schema

The proposed schema below is the original brainstorm sketch — the live
schema in **`db/schema.ts`** is the source of truth and has since added
`mediumFilename`, `lifeStage`, `sex`, `hostOrganism`, `specimenCondition`,
`taxonSubgroup`, `rawMetadata`, `hidden`, plus the renamed
`subject_state` column. Read `db/schema.ts` before writing migrations.



```typescript
// db/schema.ts
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const images = sqliteTable('images', {
  imageId:        text('image_id').primaryKey(),
  collectionId:   text('collection_id').notNull(),
  source:         text('source').notNull(),     // inaturalist | bugwood
  sourceId:       text('source_id').notNull(),
  sourcePageUrl:  text('source_page_url').notNull(),
  imageUrl:       text('image_url').notNull(),
  filename:       text('filename').notNull(),
  thumbnailFilename: text('thumbnail_filename').notNull(),
  fileSizeBytes:  integer('file_size_bytes'),
  fileSha256:     text('file_sha256').notNull(),
  width:          integer('width'),
  height:         integer('height'),
  license:        text('license').notNull(),
  licenseUrl:     text('license_url'),
  photographerAttribution: text('photographer_attribution'),
  photographer:   text('photographer'),
  institution:    text('institution'),
  taxonOrder:     text('taxon_order'),
  taxonSpecies:   text('taxon_species'),
  commonName:     text('common_name'),
  subjectState:   text('subject_state').notNull(),  // wild | captive | specimen (R4+)
  viewLabel:      text('view_label'),
  description:    text('description'),
  capturedDate:   text('captured_date'),
}, (t) => ({
  bySpecies:      index('by_species').on(t.taxonSpecies, t.commonName),
  byCollection:   index('by_collection').on(t.collectionId),
  bySource:       index('by_source').on(t.source),
  bySubjectState: index('by_subject_state').on(t.subjectState),
  byInstitution:  index('by_institution').on(t.institution),
  byTaxonOrder:   index('by_taxon_order').on(t.taxonOrder),
}));

export const reports = sqliteTable('reports', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  imageId:        text('image_id').notNull().references(() => images.imageId),
  category:       text('category').notNull(),  // low-resolution | spooky | cropped | ai-generated | other
  message:        text('message'),             // max 250 chars (for "other")
  createdAt:      integer('created_at', { mode: 'timestamp' }).notNull(),
  resolvedAt:     integer('resolved_at', { mode: 'timestamp' }),
  resolvedAction: text('resolved_action'),     // dismissed | image-hidden | image-deleted
}, (t) => ({
  byImage:        index('by_image').on(t.imageId),
  byCreated:      index('by_created').on(t.createdAt),
}));
```

### Derived "species" view (for autocomplete)

The gallery autocomplete (per §9 / port from `danbooru-uploader`) needs a
fast prefix-match over species. We don't need a separate table — just an
indexed `SELECT DISTINCT` over `images.taxonSpecies` + `images.commonName`,
optionally with a count column:

```typescript
const speciesList = await db
  .select({
    name: images.taxonSpecies,
    common: images.commonName,
    order: images.taxonOrder,
    count: sql<number>`COUNT(*)`,
  })
  .from(images)
  .groupBy(images.taxonSpecies, images.commonName);
```

If autocomplete latency degrades, promote to a materialized table at build
time. For ≤10K images this isn't needed.

### Hidden-from-users predicate

> *"Reported images can then be hidden from users until an admin has cleared
> them"*

```sql
-- Eligible-for-session pool:
SELECT * FROM images WHERE image_id NOT IN
  (SELECT image_id FROM reports WHERE resolved_at IS NULL)
```

A regular user's session query joins on `LEFT JOIN reports ... AND
reports.resolved_at IS NULL` and filters where `reports.id IS NULL`.

### Migrations / seeding

Current setup (R6 / 2026-05-15):
- Migrations: `drizzle/0000` (initial) through `drizzle/0004_taxon_subgroup.sql`
- `npm run db:generate` → `drizzle-kit generate`
- `npm run db:migrate` → `drizzle-kit migrate`
- `npm run db:push` → `drizzle-kit push` (sync schema directly, dev only)
- `npm run db:studio` → web UI on localhost
- *No db:seed* — fetchers UPSERT directly via `scripts/db.py:DbWriter` (R5).

Drizzle docs for solo-dev + local SQLite explicitly recommend `push` over
`generate + migrate` because it's "the best approach for rapid prototyping"
(https://orm.drizzle.team/docs/drizzle-kit-push). We have generate+migrate
working today; flip to push later if we want lower-friction iteration. Keep
the generated migration files as the production-deploy baseline regardless.

## 13. Data scope

- Initial download target: ~4,000-5,000 curated images across iNaturalist /
  Bugwood / Smithsonian / USDA-ARS.
- Future cap: **10,000 images** once download scripts are verified.
  > *"We can kick the upper limit of images to 10k AFTER we know that the
  > download scripts are working."*

## 14. Sketchfab integration (data + UI)

- API key: provided 2026-05-14 — stored in `.env.local`
  (`SKETCHFAB_API_KEY`, gitignored).
- Current scope: action-bar button opens prefilled Sketchfab search.
- Future scope: pre-compute `has_sketchfab_models` boolean per species via
  Sketchfab Search API.

---

## Collection-grouping rules (verified 2026-05-14)

Each `collection_id` was verified against live API responses, not inferred:

1. **iNaturalist** — `collection_id = inat-obs-<observation_id>`. Confirmed
   from API docs (the help page says "the observation doesn't present
   evidence related to one subject" is grounds for being marked casual);
   sampled 10 RG/CC-BY observations, all multi-photo observations were the
   same individual at different angles. ~10-20% of edge cases may be
   mating-pair or host-plant-with-galls — acceptable, the report button is
   the safety net. **Photos sort by `observation_photos[i].position`
   ascending.** Multi-photo: download all `observation_photos[]`, not just
   `photos[0]`. Each photo gets its own `image_id`; they share the
   `collection_id`.
2. **Bugwood** — heuristic was REFUTED. Correct schema:
   ```
   if specimen.repositorynumber and specimen.repository:
       collection_id = "bugwood-specimen-{slug(repo)}-{repo_num}"
   else:
       collection_id = "bugwood-session-{photographerimagesystemid}-{subjectid}-{descriptorid}-{day(dateacquired)}"
   ```
   Verified: voucher records expose a populated `specimen{}` object with
   `repositorynumber` (e.g. `MSUC_ARC_16562`). Non-museum images have an
   empty `specimen` — fall back to the photographer+subject+descriptor+day
   composite. `dateacquired` truncate-to-day absorbs the ~minute drift
   observed within a real specimen set.
3. ~~**Smithsonian NMNH**~~ — removed 2026-05-15 (their bug-labelling style
   was problematic for the gesture-drawing use case).
4. **USDA-ARS** — `collection_id = usda-<K-or-D prefix>` (strip trailing
   `-N`). Confirmed across 14 sets that siblings are thematically coherent
   "research story" groupings — BUT photographers, species, dates, and
   even species can vary within a prefix (e.g. K7873 mixes a sawfly and a
   psyllid, two different photographers, two different years). **Label the
   gallery grouping neutrally** — e.g. "More from this story / project",
   not "Other angles of this specimen."

## Multi-photo download policy

Per user direction "Yes on multi-photo":
- **iNat**: download every photo in `observation_photos[]`. (Future
  expansion; current 2,400-row manifest is single-photo hero shots that
  will be backfilled when we bump to the 10K cap.)
- **Smithsonian**: download every entry in `media[]` that is a
  whole-animal angle (filter out `_labels` / `_genitalia` / `_pin`).
- **Bugwood**: already multi-photo because each angle has its own
  `imgnum` and we paginate.
- **USDA-ARS**: keep singleton per image (siblings are "research story",
  not multi-angle).

## Open UI questions for brainstorming (not yet decided)

- ~~FTS5 full-text search~~ → **locked in scope**. Used for the gallery
  species autocomplete + search. Reverses my earlier "wait until measured
  slow" — at 10K-50K scale FTS5 is the right tool and the friction is one
  migration + ~60 LOC.
- ~~Insect-order color palette~~ → **locked: "Pastel Goth Kawaii"** after
  deep cute-color research. Reference palette from Kuromi/Cinnamoroll
  pastel-goth lineage — built for dark theme, pink-anchored, with deliberate
  "dusty plum / taupe" off-spectrum shades to avoid generic-pastel pitfall.
  Stored in `lib/order-colors.ts`. Preview: `previews/palette.html`. If
  rejected at implementation time, fallbacks in priority order are
  **C (NewJeans Soft Era)**, then **A (Strawberry Milk)**, then **D (Y2K)**,
  then **E (Senshi Constellation)**.

  ```typescript
  // lib/order-colors.ts
  export const orderColors: Record<string, string> = {
    Coleoptera:    '#FF6EC7',  // neon pop pink — beetles get the loudest anchor
    Lepidoptera:   '#F8B4D9',  // bubblegum     — butterflies, signature pink
    Hymenoptera:   '#FFD166',  // neon butter   — bees, naturally
    Hemiptera:     '#E16AAA',  // Malibu rose   — true bugs
    Diptera:       '#A78BFA',  // laser lilac   — soft fly purple
    Odonata:       '#67D4E6',  // Cinnamon cyan — water / dragonflies
    Orthoptera:    '#A8E6A1',  // neon mint     — grass leap
    Mantodea:      '#7FD89A',  // sage pop      — mantis predator
    Neuroptera:    '#D4C5F9',  // moonbeam lav  — delicate lacewings
    Blattodea:     '#9C8AAC',  // dusty plum    — the deliberate weird one
    Dermaptera:    '#C9A8D4',  // pastel orchid — earwig love
    Phasmatodea:   '#B8D898',  // chartreuse    — stick insects
    Trichoptera:   '#E8A8D4',  // petal pink    — caddisfly water
    Ephemeroptera: '#F0D796',  // chamomile     — soft ephemeral
    Plecoptera:    '#88B8D4',  // frost blue    — stonefly water
    Isoptera:      '#A89684',  // taupe         — termites recede
    Other:         '#B8B0C4',  // lavender-gray — fallback
  };
  ```
- Should `drizzle-kit push` replace `generate + migrate` in our dev
  workflow? (Drizzle docs recommend `push` for solo-dev local SQLite;
  we have generate+migrate working today.)

## FTS5 full-text search (added 2026-05-14)

Confirmed in scope after user pushback on lazy "wait until measured slow"
stance. **FTS5 is the right tool** for the autocomplete and gallery
species-search at our target 10K-50K image scale.

### What we get
- Word-aware tokenization (search "fire" matches "Red Fire Ant" as a word,
  not as a substring of "wildfire")
- Prefix queries via `term*` syntax (e.g. `lady*` matches "Lady Beetle")
- BM25 relevance ranking — shorter/tighter matches rank higher
- Unicode + diacritic-folded matching (`Pieris ibérica` ↔ `Pieris iberica`)
- ~10-30× faster than `LIKE %foo%` at 50K rows (~2-3 ms vs ~30-50 ms)

### Schema (raw-SQL migration since Drizzle doesn't natively support FTS5)

```sql
CREATE VIRTUAL TABLE images_fts USING fts5(
  image_id UNINDEXED,
  common_name,
  taxon_species,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Sync triggers (INSERT, UPDATE, DELETE on images)
-- Backfill from existing images at migration time
```

### Query (raw SQL via drizzle-orm `sql` template)

Last-token prefix matching for autocomplete: `searchSpecies(q)` tokenizes
the input, applies `*` suffix only to the last token, joins back to
`images` for full metadata, orders by `bm25(images_fts) ASC` then count
desc. Excludes `hidden=true` rows.

### Cache strategy unchanged

FTS5 doesn't change our `'use cache'` + `cacheTag('species-index')`
pattern. Invalidation happens via `revalidateTag('species-index')` from
`deleteImage` (the only mutation that changes the species universe).

Resolved (was open):
- ~~Styling approach~~ → lift from eagle (CSS custom properties + design
  tokens in TS).
- ~~Click-from-gallery destination~~ → `image_url` (source CDN).
- ~~Should session view honor collection grouping?~~ → Yes, via the
  "Allow same animal from different angles" toggle. Default off.
- ~~SQLite library~~ → **Drizzle ORM**.
- ~~Sketchfab gating~~ → deferred entirely, out of MVP scope.
- ~~Admin auth~~ → **HTTP Basic Auth** via `proxy.ts` (env-var bcrypt
  hash). Native browser credential prompt; no login UI to build. Re-verified
  in admin Server Functions (defense in depth).
- ~~Admin discoverability~~ → unlinked / `robots.txt` Disallow / URL-only.
- ~~Image serving~~ → Three Route Handlers (`/api/img/*`, `/api/medium/*`,
  `/api/thumb/*`) streaming from `data/`. `data/` stays out of the build.
  Medium tier (1024px) added for EU-latency. See §4b.
- ~~Next.js version~~ → **16.x**. Several patterns changed since 15:
  `middleware.ts` → `proxy.ts`; Cache Components opt-in with `'use cache'`;
  Server Functions term replaces Server Actions in docs (functionality
  unchanged, stable since 14).
- ~~Drawing-reference tools (B&W, magnifier, zoom)~~ → **all in scope**,
  ported from eagle. Genuine drawing-reference UX, not Eagle plumbing.
- ~~Timer-duration dropdown in session~~ → **yes**, ported from eagle.
  Users can change interval mid-session.
- ~~Image transition~~ → **hard cut**, no cross-fade (matches eagle; per
  user 2026-05-14).
- ~~End-of-session UX~~ → **brief "Session complete" overlay** with
  Back-to-home / New-session buttons, 15 s auto-redirect.
- ~~Source-info chip position~~ → **lower-right** (our adaptation of
  eagle's top-left chip).
- ~~Advance ding (transition cue)~~ → **plays on every advance** including
  end of session. Confirmed via eagle pattern + user vote 2026-05-14.
- ~~Initial routes~~ → `/`, `/session`, `/gallery`, `/report/[id]`,
  `/admin/reports`. No `/admin/login` (Basic Auth is browser-native).
- ~~Preload pattern~~ → port eagle's PreloadManager module (LRU cache,
  `setQueue` / `onIndexChange` / `markUsed`).
- ~~Keyboard shortcuts~~ → 10 keys (←/→/space/B/Z/+/-/0/R/Esc), all gated
  by input-focus check.

End of capture.
