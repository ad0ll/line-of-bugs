import { db } from "@/db";
import { TAXON_GROUPS } from "@/lib/taxonomy";
import { buildFtsTag } from "@/lib/queries/filter-clauses";
import { sql } from "drizzle-orm";

interface ResultRow {
  kind: "group" | "species";
  /** URL-encodable value: for group, the chip key (e.g. "butterflies"); for species, the common name OR scientific. */
  value: string;
  /** Human-readable label shown in the autocomplete dropdown. */
  label: string;
  /** Pre-computed count of matching images. */
  count: number;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) {
    // Picker default: all groups by count desc — so the dropdown shows
    // candidates as soon as it opens, matching AllOrChipsFilter behavior.
    const groupResults: ResultRow[] = TAXON_GROUPS.map((g) => {
      const counts = db.all<{ c: number }>(sql`
        SELECT COUNT(*) AS c FROM images
        WHERE hidden = 0 AND taxon_subgroup IN (${sql.join(
          g.dbValues.map((v) => sql`${v}`),
          sql`, `,
        )})
      `);
      return {
        kind: "group" as const,
        value: g.key,
        label: g.label,
        count: counts[0]?.c ?? 0,
      };
    }).sort((a, b) => b.count - a.count);
    return Response.json(
      { results: groupResults },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  }

  // Group matches: substring match against the chip's user-facing label.
  const groupResults: ResultRow[] = [];
  for (const g of TAXON_GROUPS) {
    if (g.label.toLowerCase().includes(q)) {
      // Count = sum of image counts across the group's dbValues.
      const counts = db.all<{ c: number }>(sql`
        SELECT COUNT(*) AS c FROM images
        WHERE hidden = 0 AND taxon_subgroup IN (${sql.join(g.dbValues.map((v) => sql`${v}`), sql`, `)})
      `);
      groupResults.push({
        kind: "group",
        value: g.key,
        label: g.label,
        count: counts[0]?.c ?? 0,
      });
    }
  }

  // Species matches via FTS5 — reuse the same buildFtsTag helper SpeciesAutocomplete uses.
  // Each result is one common-name + species pair with its image count.
  const ftsExpr = buildFtsTag(q);
  const speciesResults: ResultRow[] = [];
  if (ftsExpr) {
    const rows = db.all<{ common_name: string; taxon_species: string; c: number }>(sql`
      SELECT i.common_name, i.taxon_species, COUNT(*) AS c
      FROM images_fts f
      JOIN images i ON i.image_id = f.image_id
      WHERE images_fts MATCH ${ftsExpr}
        AND i.hidden = 0
      GROUP BY i.common_name, i.taxon_species
      ORDER BY c DESC
      LIMIT 15
    `);
    for (const r of rows) {
      const label = r.common_name || r.taxon_species || "(unnamed)";
      const value = r.common_name || r.taxon_species;
      if (!value) continue;
      speciesResults.push({
        kind: "species",
        value,
        label,
        count: r.c,
      });
    }
  }

  // Interleave: groups first (more general), then species. Cap at 20 total.
  const combined = [...groupResults, ...speciesResults].slice(0, 20);
  return Response.json({ results: combined }, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
