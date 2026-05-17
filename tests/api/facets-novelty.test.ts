import { describe, it, expect } from "vitest";
import { getFacetCounts } from "@/lib/queries/facets";

describe("getFacetCounts: novelty-aware total", () => {
  it("show-everything mode returns raw filter count", async () => {
    const snap = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
      novelty: "show-everything",
    });
    expect(snap.total).toBeGreaterThan(0);
  });

  it("never-repeat-species returns distinct-species count", async () => {
    const showAll = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
      novelty: "show-everything",
    });
    const distinct = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
      novelty: "never-repeat-species",
    });
    // Distinct species ≤ all photos (many photos share a species)
    expect(distinct.total).toBeLessThanOrEqual(showAll.total);
    expect(distinct.total).toBeGreaterThan(0);
  });

  it("allow-different-angles returns distinct-collection count", async () => {
    const distinct = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
      novelty: "allow-different-angles",
    });
    expect(distinct.total).toBeGreaterThan(0);
  });

  it("species filter narrows novelty count", async () => {
    const noFilter = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
      novelty: "never-repeat-species",
    });
    const withGroup = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: ["butterflies"],
      novelty: "never-repeat-species",
    });
    expect(withGroup.total).toBeLessThan(noFilter.total);
  });
});
