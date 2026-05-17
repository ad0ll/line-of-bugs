// app/api/admin/sketchfab/upsert/route.ts
//
// Bulk UPSERT into species_metadata. Used by the remote enrichment agent
// (Windmill / Pi) to push results back to prod. proxy.ts already enforces
// Basic Auth on /api/admin/* — no auth check here.
//
// Request body:
//   { rows: Array<{ taxon_species: string,
//                   has_models: boolean,
//                   hit_count: number,
//                   hits_json: string | null }> }
//
// hits_json is the JSON-stringified SketchfabHit[] (or null when has_models
// is false). All four fields are required per row.
//
// Single SQLite transaction wraps the whole batch — partial failure rolls
// back. Idempotent: re-POSTing the same rows just refreshes the timestamps.
//
// Response:
//   200 { upserted: <n> }
//   400 invalid body
//   413 batch too large (>500 rows — protects against runaway clients)

import { sqlite } from "@/db";

const MAX_BATCH = 500;

interface UpsertRow {
  taxon_species: string;
  has_models: boolean;
  hit_count: number;
  hits_json: string | null;
}

function isUpsertRow(x: unknown): x is UpsertRow {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.taxon_species === "string" &&
    r.taxon_species.length > 0 &&
    typeof r.has_models === "boolean" &&
    typeof r.hit_count === "number" &&
    Number.isFinite(r.hit_count) &&
    r.hit_count >= 0 &&
    (r.hits_json === null || typeof r.hits_json === "string")
  );
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!body || typeof body !== "object" || !Array.isArray((body as { rows?: unknown }).rows)) {
    return new Response(
      JSON.stringify({ error: "body must be { rows: [...] }" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const rows = (body as { rows: unknown[] }).rows;

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ upserted: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (rows.length > MAX_BATCH) {
    return new Response(
      JSON.stringify({ error: `batch too large (${rows.length} > ${MAX_BATCH})` }),
      { status: 413, headers: { "Content-Type": "application/json" } },
    );
  }

  // Validate every row before opening the transaction so we don't partially
  // commit then bail.
  for (let i = 0; i < rows.length; i++) {
    if (!isUpsertRow(rows[i])) {
      return new Response(
        JSON.stringify({ error: `row ${i} invalid: expected { taxon_species: string, has_models: boolean, hit_count: number >= 0, hits_json: string|null }` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  const validated = rows as UpsertRow[];

  const now = Math.floor(Date.now() / 1000);
  const stmt = sqlite.prepare(
    `INSERT INTO species_metadata
        (taxon_species, has_sketchfab_models, sketchfab_hit_count,
         sketchfab_hits_json, sketchfab_last_checked_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(taxon_species) DO UPDATE SET
        has_sketchfab_models       = excluded.has_sketchfab_models,
        sketchfab_hit_count        = excluded.sketchfab_hit_count,
        sketchfab_hits_json        = excluded.sketchfab_hits_json,
        sketchfab_last_checked_at  = excluded.sketchfab_last_checked_at`,
  );

  // better-sqlite3 transactions are synchronous + atomic.
  const tx = sqlite.transaction((batch: UpsertRow[]) => {
    for (const row of batch) {
      stmt.run(
        row.taxon_species,
        row.has_models ? 1 : 0,
        row.hit_count,
        row.hits_json,
        now,
      );
    }
  });
  tx(validated);

  return new Response(
    JSON.stringify({ upserted: validated.length }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}
