import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import type { Image } from "@/db/schema";
import { POST } from "@/app/api/session/start/route";
import { buildSessionPool } from "@/lib/queries/session";
import { getPool, setPool, _clearAll } from "@/lib/session-pools";
import { sqlite } from "@/db";

const fakeImg = (id: string): Image => ({
  imageId: id, collectionId: "c", source: "inaturalist", sourceId: id,
  sourcePageUrl: "", imageUrl: "", filename: "", thumbnailFilename: "",
  mediumFilename: "", fileSizeBytes: 0, fileSha256: "", width: 100, height: 100,
  license: "cc-by-4.0", licenseUrl: null, photographerAttribution: null,
  photographer: null, institution: null, taxonOrder: null, taxonSpecies: null,
  commonName: null, subjectState: "wild", viewLabel: null, description: null,
  capturedDate: null, hidden: false, addedAt: new Date(),
  lifeStage: null, sex: null, hostOrganism: null, specimenCondition: null, rawMetadata: null,
  taxonSubgroup: null,
});

describe("/api/session/start", () => {
  // Seed enough rows that the no-implicit-cap test can prove the
  // LIMIT 500 is gone. The base in-memory fixture (tests/fixtures/init-db.ts)
  // has only 32 images; we add 600 wild-butterfly dummies here so the
  // worker-local DB has > 500 selectable rows without affecting other
  // test files (each test file gets its own worker + in-memory DB).
  beforeAll(() => {
    const insert = sqlite.prepare(`
      INSERT OR IGNORE INTO images (
        image_id, collection_id, source, source_id, source_page_url, image_url,
        filename, thumbnail_filename, medium_filename, file_sha256, license,
        subject_state, taxon_subgroup
      ) VALUES (
        @id, @id, 'inaturalist', @id, 'https://example.test/seed', 'https://example.test/seed.jpg',
        @file, @thumb, @medium, @id, 'CC0', 'wild', 'butterfly'
      )
    `);
    const tx = sqlite.transaction(() => {
      for (let i = 0; i < 600; i++) {
        const id = `bulk-${String(i).padStart(4, "0")}`;
        insert.run({
          id,
          file: `images/${id}.jpg`,
          thumb: `thumbnails/${id}.jpg`,
          medium: `medium/${id}.jpg`,
        });
      }
    });
    tx();
  });

  beforeEach(() => _clearAll());

  it("returns a sessionId and stores the pool", async () => {
    const res = await POST(
      new Request("http://localhost/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intervalSec: 60,
          subjectType: "both",
          repeatMode: "default",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string };
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const pool = getPool(body.sessionId);
    expect(pool).toBeDefined();
    expect(pool!.items.length).toBeGreaterThan(0);
  });

  it("400s on invalid subjectType", async () => {
    const res = await POST(
      new Request("http://localhost/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intervalSec: 60, subjectType: "invalid", repeatMode: "default" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  // intervalSec validation boundary cases — the route accepts only
  // finite numbers in [10, 3600]; anything outside that range 400s.
  it.each([
    { label: "below the floor (9)", intervalSec: 9 },
    { label: "above the ceiling (3601)", intervalSec: 3601 },
    { label: "NaN", intervalSec: Number.NaN },
  ])("400s when intervalSec is $label", async ({ intervalSec }) => {
    const res = await POST(
      new Request("http://localhost/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intervalSec,
          subjectType: "both",
          repeatMode: "default",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("422s when filters resolve to an empty pool", async () => {
    // Fixture has ants only as `specimen`; asking for wild ants yields 0.
    const res = await POST(
      new Request("http://localhost/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intervalSec: 60,
          subjectType: "wild",
          repeatMode: "default",
          groups: ["ants"],
        }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("503s when the session-pool cap is reached", async () => {
    // Fill the pool table up to the cap with fresh entries so the
    // capacity-check sweep can't reclaim anything.
    for (let i = 0; i < 500; i++) {
      setPool(`fill-${i}`, [fakeImg(`i${i}`)]);
    }
    const res = await POST(
      new Request("http://localhost/api/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intervalSec: 60,
          subjectType: "both",
          repeatMode: "default",
        }),
      }),
    );
    expect(res.status).toBe(503);
  });

  it("returns full pool with no implicit cap", async () => {
    const items = await buildSessionPool({
      subjectType: "all",
      repeatMode: "default",
      views: [], lifeStages: [], sexes: [], groups: [],
    });
    // Pool should reflect the full filtered count, no 500 ceiling
    expect(items.length).toBeGreaterThan(500);
  });
});
