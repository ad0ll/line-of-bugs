-- Facet query perf.
--
-- The own-axis-exclusion pattern in lib/queries/facets.ts re-groups over the
-- whole hidden=0 set when computing a single axis (e.g. taxon_subgroup counts
-- with the groups filter dropped). Without column-cardinality stats SQLite
-- defaulted to idx_images_hidden, which selected ~40k rows and then ran the
-- "no open report" NOT EXISTS check per row — 5+ s per call.
--
-- Two fixes here:
--   1. Composite (hidden, taxon_subgroup) — gives the planner a covering path
--      for the GROUP BY without a TEMP B-TREE pass.
--   2. ANALYZE — populates sqlite_stat1/4 so the planner can compare
--      selectivity across indexes. Cheap (~40 ms on the 40k-row table).
-- Re-runs are idempotent.
CREATE INDEX IF NOT EXISTS `idx_images_hidden_taxon_subgroup`
  ON `images` (`hidden`, `taxon_subgroup`);
ANALYZE;
