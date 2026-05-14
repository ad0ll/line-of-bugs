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

- Framework: **Next.js** (TypeScript), **app router**.
- **Filesystem-based** image storage (not Eagle-DB-based, not S3, just files on the VPS).
- **SQLite** for `images`, `species`, `reports`, `admin_sessions`.
- **Drizzle ORM** for typed queries / migrations.
- **Styling**: lift from `/Users/adoll/projects/eagle-gesture-drawing` —
  see §2. CSS approach matches eagle (CSS custom properties in `globals.css`
  + ported `designTokens.ts` for inline-style consumers).

Not yet locked (open):
- Admin auth flavor (env-var password vs library like NextAuth).
- Image-serving (public/ vs API route streaming from `data/images/`).

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
  - Subject-type values: `nature` | `specimen` | both.
- "Proceed" advances to the render window.

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

## 4. Session / render screen

> *"When they proceed they will be taken to the main render window where
> the picture of the bug will be rendered w/ a timer in the top right and a
> progress bar across the top."*

Layout:
- **Timer**: top-right, always visible (eagle pattern: `mm:ss`, JetBrains
  Mono, tabular-nums).
- **Progress bar**: top edge, 4px height, fills left→right; transition
  `0.1s linear` when playing, removed when paused.
- **Image**: `object-fit: contain` at 100% viewport.

Sound cues (mirror eagle audio palette, Web Audio procedural — no asset
files):

> *"A sound will play at half time, 30s, 10s, and then 3, 2, 1."*

- Halfway, 30s remaining, 10s remaining: bell tone.
- 3-2-1 countdown: ascending tones.
- (At "time up" → advance to next image.)

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

## 5. Action bar

> *"There will be an action bar at the bottom that will let you move backward
> one image, forward one image, or pause. You will also be able to move
> backwards, forward, and pause with left, right, and space. Action bar
> will be hidden unless you move your mouse."*

Auto-hide on mousemove idle (eagle pattern: ~2s timer). Reveals on cursor
movement.

Keyboard shortcuts (defined explicitly):
- **←** — previous image
- **→** — next image
- **Space** — pause / resume

Buttons (in order — additions tracked below):
1. **Prev** image
2. **Play / Pause**
3. **Next** image
4. **Report** (see §6)
5. **Open source in new tab** — *added later*:
   > *"Action bar should also have a fifth action that's an external link
   > button that opens the image in a new tab (go to source)"*
   - Opens `source_page_url` (e.g. the iNaturalist observation page) in a
     new tab.
6. ~~**Search on Sketchfab**~~ — *deferred per user (2026-05-14): "Sketchfab
   button, out of scope for right now, we'll come back to this after we
   have the basic app working."* Notes moved to
   [`docs/sketchfab-notes.md`](./sketchfab-notes.md). API key already in
   `.env.local`.

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
  - **Subject type** (we're keeping "subject_type" rather than the
    misleading "specimen_type" name the user floated) — checkbox list with
    values `nature` / `specimen`.
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
  - `20362_inaturalist_nature_large-skipper.jpg`
  - `usnment01732150_smithsonian_specimen_bombus-sylvicola.jpg`
  - `5544659_bugwood_specimen_bean-weevil.jpg`
  - `k5388-1_usda-ars_nature_red-fire-ants.jpg`

## 12. Performance + animation tone

> *"Performance and simple animations (no going overboard) are important, the
> app should look and feel good."*

- Animations: chrome auto-hide, image cross-fade on advance, subtle
  transitions on focus/hover. **No flashy/parallax/scroll-driven effects.**
- Performance: preload the next 1-2 images during a session so the next
  advance is instant.

## 12b. SQLite ingestion (manifest → database)

Per user direction 2026-05-14: *"We just have to get things in sqlite +
drizzle I think."*

The download scripts produce CSV manifests (`data/manifest/<source>.csv` per
source, plus a unioned `manifest.csv` from `merge_manifests.py`). The app
reads these into a SQLite database at startup or via a "seed" command.

### Drizzle schema (proposed)

```typescript
// db/schema.ts
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const images = sqliteTable('images', {
  imageId:        text('image_id').primaryKey(),
  collectionId:   text('collection_id').notNull(),
  source:         text('source').notNull(),     // inaturalist | bugwood | smithsonian | usda-ars
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
  subjectType:    text('subject_type').notNull(),  // nature | specimen
  viewLabel:      text('view_label'),
  description:    text('description'),
  capturedDate:   text('captured_date'),
}, (t) => ({
  bySpecies:      index('by_species').on(t.taxonSpecies, t.commonName),
  byCollection:   index('by_collection').on(t.collectionId),
  bySource:       index('by_source').on(t.source),
  bySubjectType:  index('by_subject_type').on(t.subjectType),
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

- `db/migrations/` holds Drizzle migration files.
- A `scripts/seed.ts` (Bun or `tsx`) reads `data/manifest/manifest.csv`,
  upserts rows into `images`. Run on first deploy + on any rebuild of
  the manifest. The download scripts themselves don't touch SQLite.

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
3. **Smithsonian NMNH** — `collection_id = smithsonian-spec-<USNM_barcode>`.
   Confirmed: in a 9000-record S3 sample, USNM barcodes were never shared
   across `record_ID`s. 18.5% of image-bearing records have
   `mediaCount >= 2`; conveyor output (dorsal/lateral/face/head/labels/
   genitalia) lives in ONE record's `media[]` array, **not** as sibling
   records. Multi-image: iterate `media[]`, each entry's `idsId` (the ARK)
   is the per-image stable ID. Prefer `resources[].label == "Screen Image"`
   (~1200 px, ~200 KB) over the High-resolution JPEG (often 79 MB, way too
   big for our use case). Filter out media entries whose URL contains
   `_labels`, `_genitalia`, or `_pin` — those are pin-label scans and
   anatomical detail, not whole-animal angles.
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

- Admin auth: env-var password hash vs full auth lib (NextAuth.js).
- Image-serving: place `data/images/` and `data/thumbnails/` under
  `public/` for direct static-file serving, or stream via an API route
  (cleaner separation, allows access-checks for unreleased reports).
- Per session view: does the **next-slide cue** (currently
  `transition` sound from eagle audio-cues) also play, or is that
  noise-pollution we should skip?
- Visual treatment of the species-autocomplete "category" chip in the
  gallery — we'll repurpose Danbooru's category-color trick to color by
  insect order (Coleoptera / Lepidoptera / Odonata / etc.). Pick a small
  palette.

Resolved (was open):
- ~~Styling approach~~ → lift from eagle (CSS custom properties + design
  tokens in TS).
- ~~Click-from-gallery destination~~ → `image_url` (source CDN).
- ~~Should session view honor collection grouping?~~ → Yes, via the
  "Allow same animal from different angles" toggle. Default off.
- ~~SQLite library~~ → **Drizzle ORM**.
- ~~Sketchfab gating~~ → deferred entirely, out of MVP scope.

End of capture.
