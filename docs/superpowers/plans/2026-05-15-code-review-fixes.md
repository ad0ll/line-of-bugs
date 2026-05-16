# Code Review — Follow-Up Tracker

Replaces the original Wave 1–10 implementation plan (executed 2026-05-15).
**Status: 84 commits landed.** tsc clean, vitest 116/116, pytest 43/43,
Playwright 32 passed + 3 intentional skips + 1 env-gated `admin-auth:19`.

What follows is everything **not** done, organised by who needs to do it.

---

## 1. Operator actions before next prod deploy

These can't be done by an agent in a fresh checkout.

### 1.1 Phantom-insert `__drizzle_migrations` rows for tags 0002–0007

Wave 1 fixed `drizzle/meta/_journal.json` (which the runner reads) but the
live DB's `__drizzle_migrations` table is still missing rows for migrations
0002 through 0007 — their schema changes were applied manually before the
journal got fixed. `npm run db:migrate` will otherwise try to re-apply them
and crash with `duplicate column name`.

```bash
sqlite3 /srv/line-of-bugs/shared/data/db/line-of-bugs.db <<'SQL'
INSERT INTO __drizzle_migrations (hash, created_at) VALUES
  ('phantom_0002_fts5',                       1778811059000),
  ('phantom_0003_subject_state_and_metadata', 1778854562000),
  ('phantom_0004_taxon_subgroup',             1778873076000),
  ('phantom_0005_subject_state_notnull',      strftime('%s','now')*1000),
  ('phantom_0006_reports_dedup',              strftime('%s','now')*1000),
  ('phantom_0007_constraints_and_indexes',    strftime('%s','now')*1000);
SQL
```

After this, `npm run db:migrate` is a no-op (everything is already applied
to the live DB; the migrations are reliable for any **new** clone).

### 1.2 Apply Wave 6.9 + Wave 7 indexes to the live DB

The unique partial index from Wave 6.9 (`idx_reports_dedup_open`) and the
three indexes from Wave 7 (`idx_images_source_source_id`,
`idx_images_hidden_subject_state`, `idx_reports_pending_recent`) were
created in the migration files but never actually applied to the live DB.
After 1.1, run:

```bash
sqlite3 /srv/line-of-bugs/shared/data/db/line-of-bugs.db <<'SQL'
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_dedup_open
  ON reports(image_id, category) WHERE resolved_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_images_source_source_id
  ON images(source, source_id);
CREATE INDEX IF NOT EXISTS idx_images_hidden_subject_state
  ON images(hidden, subject_state);
CREATE INDEX IF NOT EXISTS idx_reports_pending_recent
  ON reports(created_at DESC) WHERE resolved_at IS NULL;
SQL
```

### 1.3 Rotate admin password

The old plaintext was in `tests/e2e/prod-smoke.spec.ts:50` before commit
`9afc553`. The hash in your `.env.local` and on the VPS still matches that
plaintext. Generate a new bcrypt hash and update both places:

```bash
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "<new-password>"
```

Update `ADMIN_PASSWORD_HASH=` in your local `.env.local` **and** in
`/srv/line-of-bugs/shared/.env` on the VPS, then `sudo systemctl restart
line-of-bugs`.

### 1.4 Regenerate drizzle snapshots interactively

`drizzle-kit generate` couldn't be driven from an autonomous session.
Run interactively in a clean shell so `drizzle/meta/0002_snapshot.json`
through `drizzle/meta/0007_snapshot.json` exist:

```bash
npx drizzle-kit generate --name regenerate_snapshots
# When prompted, accept the synthetic diff and delete the generated SQL
# file afterwards — only the snapshot side-effect is needed.
```

Without this, the next time someone adds a column, `drizzle-kit generate`
will diff against `0001_snapshot.json` and emit a broken migration.

---

## 2. User decisions

Things needing your judgement, not implementation work.

### 2.1 CC-BY-SA license posture

`scripts/fetch_inaturalist.py:117-119` accepts `cc-by-sa` photos. The
ShareAlike obligation never propagates to the gallery UI or stored
metadata. Options:

- (a) **Drop SA from the iNat license filter** — simplest, no legal risk,
  loses ~7% of photos.
- (b) **Tag rows with `is_sharealike`** and surface the SA badge in the
  gallery + action-bar attribution. Requires a schema column + UI work.
- (c) **Accept the obligation as-is** and document the project's own
  output as SA-licensed in a public NOTICE / README.

### 2.2 `admin-auth:19` test behaviour

It currently `throw`s when `ADMIN_PASSWORD` env is missing, which is
intentional ("no default — that would be a security smell"). Either:

- (a) Leave as-is and run with the env set when validating admin work.
- (b) Replace the throw with `test.skip(!ADMIN_PASSWORD, "...")` and accept
  the test silently doesn't run by default.

### 2.3 Three scrambled-attribution commits

Parallel-agent staging races put functionally-correct content under wrong
messages:

| Content | Commit | Wrong message |
|---|---|---|
| Wave 2.1 atomic image writes (`scripts/common.py`) | `7ae3306` | `fix(deploy): timestamp DB backups with HMS to avoid overwrite` |
| Wave 3.1 timer visibility + ref-based callbacks | `8b81f87` | `docs(deploy): note WAL caveat in seed-images.sh` |
| Wave 3.2 Timer aria-live conditional render | `a029dff` | `fix(react-query): gcTime > staleTime so cached data survives` |

Options: ignore (functionally correct on `main`); or `git rebase -i` to
split the three commits and re-message. Rebase is risky on 80+ commits;
leaving it is fine.

---

## 3. Code follow-ups (small, no architecture changes)

Pulled from the original review but not bundled into Waves 1–10.

### Frontend

- `app/components/session/Magnifier.tsx` — RAF cleanup has a small race
  window where a callback fired before `cancelAnimationFrame` can still
  call `setPos` on a stale ref. Wrap the body in a `mounted` check.
- `app/components/session/SourceInfoChip.tsx` — `aria-describedby` is
  always live even when chrome is hidden. Drop the attribute when the
  chrome `visible` prop is false.
- `app/components/admin/ConfirmDeleteButton.tsx:30-34` — `setStage("idle")`
  in `finally` runs after the card has been unmounted by the cache
  revalidation; produces a React 19 dev warning. Track mounted state via
  ref or short-circuit on success.
- `app/admin/reports/page.tsx` — admin page has no `router.refresh()`
  polling, so new reports don't show up until manual reload. Either add
  a 30-60s `router.refresh()` interval, or accept and document.
- Three duplicate `basename(p)` helpers in
  `app/components/admin/ReportCard.tsx:9`,
  `app/report/[id]/ReportPageClient.tsx:8`,
  `app/@modal/(.)report/[id]/ReportModalClient.tsx:10`. Extract to
  `lib/path-utils.ts`.

### DB / queries

- `lib/repeat-mode.ts:27-32` — `seenCollections.add(it.collectionId)`
  coerces null to the literal `null` key. Currently no impact (collectionId
  is non-null in the schema). Add a guard if the schema ever loosens.
- `db/index.ts:46-49` — `globalThis` connection cache is only active
  outside production. Production gets a fresh handle per cold start. Drop
  the `!== 'production'` guard.
- `drizzle.config.ts:4-5` duplicates `DB_PATH` resolution from
  `db/index.ts:27-28`. Extract to `lib/db-path.ts`.

### Deploy / ops

- `deploy/haproxy-fragment.cfg:22` — `compression type` list includes
  `application/json`, which gzips healthz responses (~30 bytes). Minor;
  remove or accept.
- `deploy/scripts/setup-server.sh:29-33` — `chown bawler:bawler` without
  `sudo`. Idempotent on first run if SSH user is `bawler`, fails otherwise.
- `deploy/scripts/install-fragment.sh:53-85` — Python config rewrite is
  not atomic. Has a backup at line 46 so recovery is possible, but use
  `os.replace(tmp, cfg_path)` for cleanliness.

### Tests

- `tests/python/test_metrics.py` and `tests/python/test_crop.py` — Wave
  10.9 moved the conftest into `tests/python/detect_subjects/` but these
  two files still live one level up and will error on collection because
  their fixtures (`sample_image_rgb`, `sample_bbox_normalized`,
  `sample_mask_binary`) are gone. Move both files into
  `tests/python/detect_subjects/` alongside the conftest.

---

## 4. Architecture / bigger investments (deferred from Wave 11)

Worth doing eventually; each is a session of its own.

- **Add `pytest-cov` to the pipeline**. `scripts/requirements.txt` has
  pytest + pytest-mock but no coverage. With ~10 in-scope Python files,
  unknown coverage is a risk.
- **Move `raw_metadata` to a side table**. At 40k rows × ~10KB JSON it's
  ~400MB sitting in the hot `images` scan path. A `images_metadata
  (image_id PK FK, raw_metadata text NOT NULL)` join table keeps the main
  table small. Also add `CHECK (json_valid(raw_metadata))`.
- **Native `bcrypt` swap for `bcryptjs`**. `bcryptjs` is ~10× slower per
  hash. Wave 1.4 made the call async, so the event-loop block is gone,
  but each comparison still costs 100ms+. Native bcrypt drops it to
  ~10ms. Requires adding the `bcrypt` package and removing
  `@types/bcryptjs` + `bcryptjs`.
- **Add WebKit + Firefox Playwright projects**. Currently Chromium-only.
  Safari fullscreen / AudioContext / canvas behaviours differ in ways
  that can affect the session player.
- **Deeper `prefers-reduced-motion` audit**. Wave 9.13 added
  `animation-iteration-count: 1` but a full pass would inventory every
  `@keyframes` and `transition` in `globals.css` and decide which need
  reduced-motion fallbacks.
- **CHECK constraints for enums** (deferred from Wave 7). `source`,
  `subject_state`, `life_stage`, `sex`, `category`, `resolved_action`
  are all TS-only. Adding SQL CHECK constraints requires the table-rebuild
  dance and isn't worth the disruption for the marginal safety gain
  unless the schema is being touched anyway.

---

## 5. Sensible plan deviations (FYI, no action)

Implementers correctly deviated from the original plan for these:

- **Wave 6.6** used `updateTag(tag)` instead of `revalidateTag(tag, {expire: 0})`.
  Next 16's `revalidateTag` signature now requires a profile arg;
  `updateTag` is the new read-your-own-writes API for server actions and
  matches the original "immediate invalidation" intent.
- **Wave 6.9** used `(image_id, category)` for the partial-unique-index
  instead of the plan's `(image_id, session_id)`. The `reports` schema
  has no `session_id` column and `submitReport` doesn't receive one;
  `(image_id, category)` is the closest meaningful fingerprint.
- **Wave 9.14** used Next 16's `viewport` export instead of
  `metadata.themeColor`/`metadata.colorScheme`. The latter is deprecated
  since Next 14; emit behaviour is identical.

---

## Reference

- Original review summary lives in the conversation transcript that
  produced this plan.
- Migration journal: `drizzle/meta/_journal.json` covers 0000–0007.
- Live DB: `/srv/line-of-bugs/shared/data/db/line-of-bugs.db` (VPS) or
  `data/db/line-of-bugs.db` (local copy).
