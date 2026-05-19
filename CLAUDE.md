# line-of-bugs — guidance for Claude

Student gesture-drawing webapp for insect photos. Next.js 16 App Router,
React 19, Drizzle ORM + better-sqlite3, Python fetcher pipeline. Deployed
to `line-of-bugs.com` on a Hetzner VPS via haproxy + systemd. Data lives
in `data/db/line-of-bugs.db` + filesystem image tiers under `data/`.

## Database changes

**Schema changes go through drizzle migrations. Never raw SQL on the live DB.**

When the schema needs to change:

1. Author a new migration file: `drizzle/000N_<descriptive_name>.sql`.
2. Add an entry to `drizzle/meta/_journal.json` with a matching `tag`,
   incrementing `idx`, and a `when` timestamp in ms.
3. Verify against a copy of the DB before committing:
   ```bash
   cp data/db/line-of-bugs.db /tmp/migrate-test.db
   DATABASE_URL=/tmp/migrate-test.db npx drizzle-kit migrate
   ```
4. Commit only after verification passes.

Do **not** do any of the following:

- Apply `ALTER TABLE`, `CREATE INDEX`, `DROP TABLE`, etc. directly via
  `sqlite3` against `data/db/line-of-bugs.db`.
- Insert into `__drizzle_migrations` to mark a migration as applied when
  the SQL was run by hand (this "phantom row" pattern silently desyncs
  the journal from reality).
- Edit existing migrations after they've been applied anywhere.

If the live DB has drifted from the journal (e.g., schema changes landed
via manual SQL before migrations existed for them), the **clean recovery**
is to dump the data, drop the DB, run all migrations from scratch, and
re-import. Don't paper over drift with phantom journal rows.

## Commits

- Use `--no-gpg-sign` on every commit. The repo auto-signs and pinentry
  blocks long autonomous sessions; the user has authorized this bypass.
- Use explicit `git add <file>` and `git commit --only -- <files>` when
  multiple agents are active in the same tree. Avoid `git add .` / `-A`.
- Never `git reset --hard`, `git push --force`, `git commit --amend`, or
  `git rebase` without explicit user permission.

## Replacing or renaming a UI affordance — kill its tests in the same commit

When you replace or rename a filter chip, button, popover, or any other
visible affordance, audit `tests/e2e/**` and `tests/components/**` for
specs that reference the old text, ARIA name, class, or role-shape.
Either rewrite them against the new affordance or delete them in the
same commit. Leaving stale specs behind rots the CI signal — by the
2026-05-18 filter-and-dice-redesign audit, 30+ e2e tests were red-but-
ignored because three prior generations of gallery filter UI had each
left their specs behind.

The grep heuristic before merging a UI swap:

```bash
git grep -E "<the old text or class or role-name>" tests/
```

If the grep returns hits, fix or delete them. Don't ship a UI rev that
leaves the suite worse than you found it.

## Source-of-truth conventions

- SQLite is the source of truth for everything except image bytes.
- Fetchers UPSERT directly via `scripts/db.py:DbWriter`. There is no CSV
  intermediate.
- camelCase in TS, snake_case in SQL columns.
- Image bytes live in `data/images/` (full-res), `data/medium/`
  (1024px JPEG q88), `data/thumbnails/` (512px). Each image has all three.
- Source enum is `["inaturalist", "bugwood"]` (Smithsonian + USDA-ARS
  removed 2026-05-15).

## Sketchfab enrichment runs out-of-band

The `species_metadata` table caches per-species Sketchfab search results
so prod's route handler can serve the browse panel without calling the
Sketchfab API at request time. (Required because the Hetzner egress IP
is bot-blocked by Akamai — live calls from prod always 405.)

The cache is populated by a Windmill job on a residential IP — see
`~/projects/windmill-main/docs/sketchfab-enrichment-setup.md`. It runs
daily, so any new species added by `scripts/fetch_inaturalist.py` or
`scripts/fetch_bugwood.py` will be dark on prod (button greys out) for
up to 24 hours until the next scheduled run.

**After running a fetcher that adds new species, manually trigger the
Sketchfab enrichment job** (Windmill UI → "Sketchfab Enrichment
(line-of-bugs)" → Run, or the one-off ssh command in the setup doc).
Otherwise students don't see Sketchfab models for those species until
the next morning. Local dev can run `.venv/bin/python -m
scripts.sketchfab_enrichment` directly against the local DB (no Akamai
block from a residential IP).

## Out-of-scope code

Anything under `scripts/detect_subjects/` is a WIP ML pipeline. Don't
modify it for code-review fixes, refactors, or test cleanup unless the
user explicitly asks.

## Use concurrency in backend code — beefy hardware

The dev machine is an M5 Max MacBook Pro: 16-core CPU, 40-core GPU, 128GB
unified memory. **Single-threaded backend loops leave significant capacity
on the floor.** Default to concurrent execution when:

- Processing many images (`concurrent.futures.ThreadPoolExecutor` for I/O
  + CPU; `ProcessPoolExecutor` if CPU-heavy work needs to bypass the GIL)
- Multiple independent inferences could batch (call model with batched
  inputs — most HF processors accept `images=[img1, img2, ...]`)
- Database queries with independent results (gather via async or threads)
- Multiple HTTP fetches (gather concurrently, don't await sequentially)

Constraints:
- GPU memory is shared with system memory (unified) — don't over-batch SAM
  3 or DINO; ~4 concurrent inference workers is a reasonable cap
- Parquet writes must be serialized (use a single writer thread or batched
  flush with a `threading.Lock`)
- Don't parallelize calls that share mutable state (`Sam3Processor`
  instances are not thread-safe; use one per worker OR a process pool)

If you're writing a new pipeline loop, ask "could this be a `with
ThreadPoolExecutor(max_workers=N) as ex: ex.map(...)`?" — usually yes.

## ML pipeline bbox visual smoke test (Claude responsibility)

**Always visually smoke-test bbox quality before asking the user to review.**

After any change that affects which bboxes get picked (model swap, prompt
change, knob tune), Claude (not the user) runs the bbox overlay renderer
and inspects the output:

Two-tier protocol:

1. **Iterative 30-image samples during knob tuning** —
   ```
   .venv/bin/python -m tools.render_bbox_overlays \
       --variant sam3__sam3 --n 30 --out /tmp/bbox_check_30/
   ```
   Read each `/tmp/bbox_check_30/*.jpg` via the Read tool. Report:
   `X/30 sensible, Y/30 wrong subject, Z/30 wildly clipped, problem image_ids: [...]`.
   If ≥20% obvious failures, recommend knob tuning + iterate with a fresh
   30-sample after each tune. Keep tuning until confident.

2. **Final 50-image confidence check before human review** —
   ```
   .venv/bin/python -m tools.render_bbox_overlays \
       --variant sam3__sam3 --n 50 --out /tmp/bbox_check_final_50/ --seed-fresh
   ```
   Use `--seed-fresh` so the 50 don't overlap with prior 30-samples.
   Read all 50, report pass rate + recommendation. Only hand off to user
   when the final 50 looks clean.

Don't burn the user's review time on output Claude could've caught.

## ML pipeline vocabulary (`scripts/detect_subjects/`)

After the 2026-05-16 Phase 1 refactor, the modular pipeline composes:

- **detector** — text-prompted object detector emitting bbox + confidence
  + per-detection phrase. Wrappers in `detectors/` (registry in
  `detectors/__init__.py`). Current: `grounding_dino`. Swap via
  `cfg.DETECTOR_VARIANT`.
- **segmenter** — bbox-conditioned mask producer. Wrappers in
  `segmenters/`. Current: `insectsam`. Swap via `cfg.SEGMENTER_VARIANT`.
- **features.py** — pure functions computing bbox/mask/sharpness scalars
  from primitives. No model dependencies; testable in isolation.
- **rule_labeler.py** (was `classify.py`) — hand-written rules over
  features → `suggested_labels`. Tuned thresholds live in `config.py`.
- **ml_labeler** — future learned classifiers consuming the same features
  (Phase 3). Implements the `MLLabeler` Protocol in `interfaces.py`.
- **gate.py** — `decide_drawability()` collapses all label sources into
  one strict KEEP/REJECT. Dead code in Phase 1; wired in Phase 2 once the
  validator UI migrates to the new vocabulary.
- **classify.py** (was `pipeline.py`) — orchestrator. Calls factories,
  computes features, runs rule labeler, writes parquet rows.
- **interfaces.py** — `Detector` / `Segmenter` / `MLLabeler` Protocols
  + `DetectionResult` / `SegmentationResult` dataclasses. Source of truth
  for stage contracts.
- **variant_tag** — `cfg.variant_tag()` returns `{detector}__{segmenter}`,
  written to the parquet `variant` column for A/B filtering. (Phase 1
  keeps `V1_NAME = "v1_dino_insectsam"` for legacy compat; Phase 2
  introduces `variant_tag()`-based strings.)
- **labels.json** — `data/cache/labels.json`, human-curated ground truth
  used to evaluate rule-labeler thresholds (`evaluate_pipeline.py`).

## Reference

- Design system: `docs/design-system.md`
- UI spec: `docs/ui-spec.md`
- Sketchfab API notes: `docs/sketchfab-notes.md`
- Deploy runbook: `deploy/README.md`
- Pending follow-ups: `docs/superpowers/plans/2026-05-15-code-review-fixes.md`
