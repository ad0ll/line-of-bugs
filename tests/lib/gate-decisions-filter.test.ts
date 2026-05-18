import { describe, it, expect, beforeEach } from "vitest";
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
    // 32 fixture images, all should be visible.
    expect(result.totalCount).toBe(32);
  });
});
