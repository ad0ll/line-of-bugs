// app/api/admin/sketchfab/species/route.ts
//
// Lists (taxon_species, common_name) pairs that need Sketchfab enrichment.
// Used by the remote enrichment agent (Windmill / Pi) — see
// scripts/sketchfab_enrichment_remote.py.
//
// proxy.ts already enforces Basic Auth on /api/admin/* — no auth check here.
//
// Returns species whose precache row is either missing or older than
// `?max_age_days=N` (default 1). Optional `?limit=N` caps the response
// for partial runs.
//
// Response shape:
//   { species: Array<{ taxon_species: string, common_name: string,
//                      last_checked_at: number | null }> }

import { sqlite } from "@/db";

interface SpeciesRow {
  taxon_species: string;
  common_name: string;
  last_checked_at: number | null;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const maxAgeDays = Number(url.searchParams.get("max_age_days") ?? "1");
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    return new Response(
      JSON.stringify({ error: "max_age_days must be a non-negative number" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam === null ? null : Number(limitParam);
  if (limit !== null && (!Number.isFinite(limit) || limit < 1)) {
    return new Response(
      JSON.stringify({ error: "limit must be a positive integer" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const cutoff = Math.floor(Date.now() / 1000) - maxAgeDays * 86400;

  // Drizzle's `.get()`/`.all()` don't play well with the DISTINCT + LEFT JOIN
  // shape we need, so drop to raw sqlite for clarity. Read-only query.
  const sql =
    `SELECT DISTINCT i.taxon_species AS taxon_species,
                     i.common_name   AS common_name,
                     sm.sketchfab_last_checked_at AS last_checked_at
       FROM images i
       LEFT JOIN species_metadata sm ON sm.taxon_species = i.taxon_species
      WHERE i.taxon_species IS NOT NULL
        AND i.common_name   IS NOT NULL
        AND TRIM(i.taxon_species) <> ''
        AND TRIM(i.common_name)   <> ''
        AND (sm.sketchfab_last_checked_at IS NULL
             OR sm.sketchfab_last_checked_at < ?)
      ORDER BY (sm.sketchfab_last_checked_at IS NOT NULL),
               sm.sketchfab_last_checked_at` +
    (limit !== null ? ` LIMIT ?` : ``);

  const stmt = sqlite.prepare(sql);
  const rows = (limit !== null ? stmt.all(cutoff, limit) : stmt.all(cutoff)) as SpeciesRow[];

  return new Response(
    JSON.stringify({ species: rows, count: rows.length }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}
