import { describe, it, expect, beforeEach, vi } from "vitest";
import { sqlite } from "@/db";
import { markRejected, markKept } from "../fixtures/init-db";
import { searchGallery } from "@/lib/queries/gallery";
import { buildSessionPool, countSessionPool } from "@/lib/queries/session";
import { getFacetCounts } from "@/lib/queries/facets";

const ALL_FILTERS_NEUTRAL = {
  subjectType: "all" as const,
  views: [], lifeStages: [], sexes: [], groups: [],
};

describe("gate_decisions filter integration", () => {
  beforeEach(() => {
    // Reset gate_decisions between tests so a previous rejection
    // doesn't leak into the next test's baseline counts.
    sqlite.prepare("DELETE FROM gate_decisions").run();
  });

  it("excludes a rejected image from searchGallery results", async () => {
    const initial = await searchGallery({
      q: [], subject: "all", institutions: [],
      views: [], lifeStages: [], sexes: [], groups: [], page: 1,
    });
    const beforeIds = new Set(initial.rows.map((r) => r.image_id));
    expect(beforeIds.has("test-000")).toBe(true);
    const beforeTotal = initial.totalCount;

    markRejected("test-000", "rule:bbox-content_no-bug");

    const after = await searchGallery({
      q: [], subject: "all", institutions: [],
      views: [], lifeStages: [], sexes: [], groups: [], page: 1,
    });
    const afterIds = new Set(after.rows.map((r) => r.image_id));
    expect(afterIds.has("test-000")).toBe(false);
    expect(after.totalCount).toBe(beforeTotal - 1);
  });

  it("excludes a rejected image from buildSessionPool", async () => {
    markRejected("test-001", "ml:mask_blur_unusable:0.92");
    const pool = await buildSessionPool({
      ...ALL_FILTERS_NEUTRAL,
      repeatMode: "default",
    });
    const ids = new Set(pool.map((p) => p.imageId));
    expect(ids.has("test-001")).toBe(false);
  });

  it("excludes a rejected image from countSessionPool", async () => {
    const before = await countSessionPool(ALL_FILTERS_NEUTRAL);
    markRejected("test-002", "hand:mask:mask_blur_unusable");
    const after = await countSessionPool(ALL_FILTERS_NEUTRAL);
    expect(after).toBe(before - 1);
  });

  it("excludes a rejected image from getFacetCounts.total", async () => {
    const before = await getFacetCounts(ALL_FILTERS_NEUTRAL);
    markRejected("test-003");
    const after = await getFacetCounts(ALL_FILTERS_NEUTRAL);
    expect(after.total).toBe(before.total - 1);
  });

  it("a 'keep' decision row does not hide an image", async () => {
    markKept("test-004");
    const result = await searchGallery({
      q: [], subject: "all", institutions: [],
      views: [], lifeStages: [], sexes: [], groups: [], page: 1,
    });
    const ids = new Set(result.rows.map((r) => r.image_id));
    expect(ids.has("test-004")).toBe(true);
  });

  it("images with NO gate_decisions row are still served (vacuous truth)", async () => {
    // Sanity check: an empty gate_decisions table is the baseline.
    // No rejection rows means nothing excluded — every fixture image visible.
    const result = await searchGallery({
      q: [], subject: "all", institutions: [],
      views: [], lifeStages: [], sexes: [], groups: [], page: 1,
    });
    // 34 fixture images (32 named subgroups + 2 NULL-subgroup rows added
    // for the WhatIsBugFilter empty-q `weird`-group NULL rollup test), all
    // visible when gate_decisions is empty.
    expect(result.totalCount).toBe(34);
  });

  it("getImage returns null for a rejected image", async () => {
    // Defensive: getImage is wrapped in React's cache(). In the non-server-
    // components React bundle (what Vitest resolves today) cache() is a
    // transparent no-op, but if bundle resolution ever changes the memoization
    // would make the post-mark call return the stale pre-mark result and the
    // test would silently always pass. vi.resetModules() before each await
    // import re-evaluates the module so we get a fresh cache() wrapper.
    vi.resetModules();
    const sess1 = await import("@/lib/queries/session");
    const before = await sess1.getImage("test-005");
    expect(before).toBeDefined();
    expect(before?.imageId).toBe("test-005");

    markRejected("test-005", "rule:bbox-content_no-bug");
    vi.resetModules();
    const sess2 = await import("@/lib/queries/session");
    const after = await sess2.getImage("test-005");
    expect(after).toBeFalsy();   // null or undefined — both mean "not served"
  });

  it("listInstitutions excludes counts from rejected images", async () => {
    // First seed an institution string on two fixture images (the base
    // fixture doesn't populate `institution`).
    sqlite
      .prepare("UPDATE images SET institution = ? WHERE image_id IN (?, ?)")
      .run("Test Museum", "test-006", "test-007");
    const { listInstitutions } = await import("@/lib/queries/gallery");
    const before = await listInstitutions();
    const beforeRow = before.find((r) => r.name === "Test Museum");
    expect(beforeRow?.count).toBe(2);

    markRejected("test-006");
    const after = await listInstitutions();
    const afterRow = after.find((r) => r.name === "Test Museum");
    expect(afterRow?.count).toBe(1);
  });

  it("searchSpecies excludes rejected images from autocomplete counts", async () => {
    const { searchSpecies } = await import("@/lib/queries/gallery");
    const before = await searchSpecies("butterfly");
    const beforeTotal = before.reduce((s, r) => s + r.count, 0);
    expect(beforeTotal).toBeGreaterThan(0);

    // Pick any butterfly and mark it rejected.
    const butterfly = sqlite
      .prepare("SELECT image_id FROM images WHERE taxon_subgroup = 'butterfly' LIMIT 1")
      .get() as { image_id: string };
    markRejected(butterfly.image_id);

    const after = await searchSpecies("butterfly");
    const afterTotal = after.reduce((s, r) => s + r.count, 0);
    expect(afterTotal).toBe(beforeTotal - 1);
  });
});
