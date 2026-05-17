// tests/api/admin-sketchfab.test.ts
//
// Integration tests for the remote-agent admin endpoints. They hit the
// in-memory SQLite (per tests/setup-node.ts) — no HTTP mocking needed,
// the routes touch real Drizzle/sqlite.
//
// proxy.ts auth is OUT of scope here; the route handlers don't check
// auth themselves (proxy.ts does, before they're reached). Tests
// invoke GET/POST directly.

import { describe, it, expect, beforeEach } from "vitest";
import { sqlite } from "@/db";
import { GET as listSpecies } from "@/app/api/admin/sketchfab/species/route";
import { POST as upsert } from "@/app/api/admin/sketchfab/upsert/route";

function clearMetadata() {
  sqlite.prepare("DELETE FROM species_metadata").run();
}

describe("GET /api/admin/sketchfab/species", () => {
  beforeEach(clearMetadata);

  it("returns species with no precache row (never checked)", async () => {
    const r = await listSpecies(
      new Request("http://x/api/admin/sketchfab/species?max_age_days=1"),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    // tests/fixtures/init-db.ts seeds 32 distinct test species
    expect(body.count).toBeGreaterThan(0);
    expect(body.species[0]).toMatchObject({
      taxon_species: expect.any(String),
      common_name: expect.any(String),
      last_checked_at: null,
    });
  });

  it("excludes species whose precache is fresh (within max_age_days)", async () => {
    // Insert a recent row for an existing test species
    const sci = "Testus butterflyicus 1";
    const now = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        "INSERT INTO species_metadata (taxon_species, has_sketchfab_models, sketchfab_hit_count, sketchfab_last_checked_at, sketchfab_hits_json) VALUES (?, 0, 0, ?, NULL)",
      )
      .run(sci, now);

    const r = await listSpecies(
      new Request("http://x/api/admin/sketchfab/species?max_age_days=1"),
    );
    const body = await r.json();
    const sciList = body.species.map((s: { taxon_species: string }) => s.taxon_species);
    expect(sciList).not.toContain(sci);
  });

  it("includes species whose precache is stale (older than max_age_days)", async () => {
    const sci = "Testus butterflyicus 1";
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 86400;
    sqlite
      .prepare(
        "INSERT INTO species_metadata (taxon_species, has_sketchfab_models, sketchfab_hit_count, sketchfab_last_checked_at) VALUES (?, 1, 5, ?)",
      )
      .run(sci, tenDaysAgo);

    const r = await listSpecies(
      new Request("http://x/api/admin/sketchfab/species?max_age_days=1"),
    );
    const body = await r.json();
    const sciList = body.species.map((s: { taxon_species: string }) => s.taxon_species);
    expect(sciList).toContain(sci);
  });

  it("respects ?limit", async () => {
    const r = await listSpecies(
      new Request("http://x/api/admin/sketchfab/species?max_age_days=1&limit=3"),
    );
    const body = await r.json();
    expect(body.species).toHaveLength(3);
  });

  it("400s on invalid max_age_days", async () => {
    const r = await listSpecies(
      new Request("http://x/api/admin/sketchfab/species?max_age_days=-1"),
    );
    expect(r.status).toBe(400);
  });
});

describe("POST /api/admin/sketchfab/upsert", () => {
  beforeEach(clearMetadata);

  it("upserts a batch + returns the count", async () => {
    const r = await upsert(
      new Request("http://x/api/admin/sketchfab/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: [
            {
              taxon_species: "Apis mellifera",
              has_models: true,
              hit_count: 5,
              hits_json: JSON.stringify([{ uid: "u1", name: "Bee" }]),
            },
            {
              taxon_species: "Nonexistus speciosus",
              has_models: false,
              hit_count: 0,
              hits_json: null,
            },
          ],
        }),
      }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ upserted: 2 });

    const rows = sqlite
      .prepare("SELECT taxon_species, has_sketchfab_models, sketchfab_hits_json FROM species_metadata ORDER BY taxon_species")
      .all();
    expect(rows).toEqual([
      { taxon_species: "Apis mellifera", has_sketchfab_models: 1, sketchfab_hits_json: '[{"uid":"u1","name":"Bee"}]' },
      { taxon_species: "Nonexistus speciosus", has_sketchfab_models: 0, sketchfab_hits_json: null },
    ]);
  });

  it("ON CONFLICT updates the existing row", async () => {
    sqlite
      .prepare(
        "INSERT INTO species_metadata (taxon_species, has_sketchfab_models, sketchfab_hit_count, sketchfab_last_checked_at, sketchfab_hits_json) VALUES (?, 1, 5, ?, ?)",
      )
      .run("Apis mellifera", 1000, '[{"uid":"old"}]');

    const r = await upsert(
      new Request("http://x/api/admin/sketchfab/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: [
            {
              taxon_species: "Apis mellifera",
              has_models: false,
              hit_count: 0,
              hits_json: null,
            },
          ],
        }),
      }),
    );
    expect(r.status).toBe(200);
    const row = sqlite
      .prepare("SELECT has_sketchfab_models, sketchfab_hit_count, sketchfab_hits_json FROM species_metadata WHERE taxon_species = ?")
      .get("Apis mellifera");
    expect(row).toEqual({ has_sketchfab_models: 0, sketchfab_hit_count: 0, sketchfab_hits_json: null });
  });

  it("400s on invalid body shape", async () => {
    const r = await upsert(
      new Request("http://x/api/admin/sketchfab/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: "not an array" }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it("400s on per-row validation failure (rolls back whole batch)", async () => {
    const r = await upsert(
      new Request("http://x/api/admin/sketchfab/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: [
            { taxon_species: "ok", has_models: true, hit_count: 1, hits_json: null },
            { taxon_species: "bad", has_models: "not-bool", hit_count: 0, hits_json: null },
          ],
        }),
      }),
    );
    expect(r.status).toBe(400);
    // First row should NOT be in the DB — validation rejects the whole batch.
    const row = sqlite
      .prepare("SELECT * FROM species_metadata WHERE taxon_species = ?")
      .get("ok");
    expect(row).toBeUndefined();
  });

  it("413s on oversize batch (>500 rows)", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      taxon_species: `S${i}`,
      has_models: false,
      hit_count: 0,
      hits_json: null,
    }));
    const r = await upsert(
      new Request("http://x/api/admin/sketchfab/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      }),
    );
    expect(r.status).toBe(413);
  });

  it("empty batch returns 200 with upserted=0", async () => {
    const r = await upsert(
      new Request("http://x/api/admin/sketchfab/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: [] }),
      }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ upserted: 0 });
  });
});
