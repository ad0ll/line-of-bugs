# Round 5 + future-work notes

## R5: SQLite-direct fetchers (drop the CSV intermediate)

**Why:** The data pipeline is currently `fetchers → data/manifest/*.csv → db/seed.ts → data/db/line-of-bugs.db`. The app reads only SQLite, but the CSV intermediate exists for historical reasons. It creates real friction:

- `csv.field_size_limit(sys.maxsize)` workaround needed for `raw_metadata` JSON blobs (200KB+).
- Two places to keep in sync when columns change (`scripts/common.py:MANIFEST_FIELDS` + `db/schema.ts`).
- One-shot CSV migration script every time the schema moves (e.g., `/tmp/migrate_manifests_round4.py` for `subject_type → subject_state`).
- CSV/DB drift risk — only the seed reconciles them.
- Bigger disk footprint (CSV ~2-3 GB once `raw_metadata` is populated, on top of the DB).

**What to do:**

1. Replace `ManifestWriter` in `scripts/common.py` with a `DbWriter` that uses Python's stdlib `sqlite3` to UPSERT directly into the `images` table. Same `has()` / `write()` / `count()` interface so fetchers don't change shape.
2. Mirror the column list in one place (Python TypedDict or dataclass) generated from `db/schema.ts` if practical, or hand-maintained — there are only ~26 columns and they change rarely.
3. Delete `data/manifest/` and the migration helper scripts.
4. Keep `db/seed.ts` only as a "rebuild FTS5 + indexes" helper, or delete entirely.
5. WAL mode is already on, so concurrent writes (Python fetcher + Next.js reader) coexist fine — verify with a smoke test.

**Cost:** Maybe 4-6 hours. Mostly mechanical. The biggest care item is making sure Python's `INSERT OR REPLACE` matches the Drizzle `onConflictDoUpdate` semantics for the `images` table.

**Don't lose:** The audit trail of "what we fetched + when" is currently implicit in CSV append order. If we go direct-to-DB, the `added_at` column already captures this.

## Other backlog items (not necessarily R5)

- **iNat captive imports** — `subject_state = "captive"` value is reserved in the enum but never populated. The iNat fetcher filters `captive=false` at fetch time. Could open a second iNat pull pass with `captive=true` (zoos, butterfly conservatories, gardens) and assign `subject_state="captive"`. Useful for art-students wanting controlled-lighting reference shots.

- **Layperson taxonomy filter** — adding `taxon_order` as a gallery + home filter with common-name labels ("beetles" / "butterflies & moths" / "bees & wasps" / "true bugs" / etc.). Punted on 2026-05-15; user asked we wait. Underlying data exists (`taxon_order` populated for all rows); just needs a UI surface + a `lib/taxonomy.ts` mapping table.

- ~~USDA-ARS DNS~~ — source removed entirely on 2026-05-15 (host had been unreachable on this VPN for too long to be worth keeping around).
