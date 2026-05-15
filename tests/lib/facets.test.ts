import { describe, it, expect } from "vitest";
import { getFacetCounts } from "@/lib/queries/facets";
import type { FilterState } from "@/lib/queries/filter-clauses";

// These tests run against the live data/db/line-of-bugs.db.
// The ~40k-image snapshot is stable enough for these assertions
// (specific counts use ranges, not exact numbers).

const empty: FilterState = {
  subjectType: "all",
  views: [],
  lifeStages: [],
  sexes: [],
  groups: [],
};

// Facet counts run several COUNT(*) queries over the live ~40k-row DB;
// when other test files share the better-sqlite3 handle in parallel,
// each query can take a couple of seconds. Generous timeout keeps these
// stable in CI without bloating fast tests.
describe("getFacetCounts", { timeout: 30000 }, () => {
  it("returns total + counts for every axis when no filters applied", async () => {
    const snap = await getFacetCounts(empty);
    expect(snap.total).toBeGreaterThan(30000);
    expect(snap.subject.wild).toBeGreaterThan(0);
    expect(snap.subject.captive).toBeGreaterThan(0);
    expect(snap.subject.specimen).toBeGreaterThan(0);
    // 21 chips total; some may be zero in the test data but the array
    // is returned in full so the UI can render placeholders/grey-outs.
    expect(snap.taxonGroups.length).toBe(21);
    expect(snap.taxonGroups.find((g) => g.name === "butterflies")?.count).toBeGreaterThan(0);
  });

  it("cross-axis: switching subject from wild to specimen changes butterfly count", async () => {
    const wild = await getFacetCounts({ ...empty, subjectType: "wild" });
    const specimen = await getFacetCounts({ ...empty, subjectType: "specimen" });
    const wildBut = wild.taxonGroups.find((g) => g.name === "butterflies")!.count;
    const specBut = specimen.taxonGroups.find((g) => g.name === "butterflies")!.count;
    expect(wildBut).not.toBe(specBut);
  });

  it("within-axis: selecting butterflies leaves cockroach bucket UNCHANGED", async () => {
    const baseline = await getFacetCounts(empty);
    const withBut = await getFacetCounts({ ...empty, groups: ["butterflies"] });
    const baselineRoach = baseline.taxonGroups.find((g) => g.name === "cockroaches")!.count;
    const withRoach = withBut.taxonGroups.find((g) => g.name === "cockroaches")!.count;
    expect(withRoach).toBe(baselineRoach);
  });

  it("within-axis: selecting butterflies leaves butterfly bucket UNCHANGED (own-axis exclusion)", async () => {
    const baseline = await getFacetCounts(empty);
    const withBut = await getFacetCounts({ ...empty, groups: ["butterflies"] });
    const baseB = baseline.taxonGroups.find((g) => g.name === "butterflies")!.count;
    const withB = withBut.taxonGroups.find((g) => g.name === "butterflies")!.count;
    expect(withB).toBe(baseB);
  });

  it("total narrows when multiple axes filter", async () => {
    const all = await getFacetCounts(empty);
    const captiveButterflies = await getFacetCounts({
      ...empty,
      subjectType: "captive",
      groups: ["butterflies"],
    });
    expect(captiveButterflies.total).toBeGreaterThan(0);
    expect(captiveButterflies.total).toBeLessThan(all.total);
  });

  it("subject facet ignores its own selection", async () => {
    // Pick wild only; subject.captive/specimen should still be non-zero
    // (they're computed without the subject filter applied).
    const snap = await getFacetCounts({ ...empty, subjectType: "wild" });
    expect(snap.subject.captive).toBeGreaterThan(0);
    expect(snap.subject.specimen).toBeGreaterThan(0);
  });

  it("returns zero-count taxon buckets so the UI can grey them out", async () => {
    // Pick an unlikely cross-axis selection; some chips drop to 0.
    const snap = await getFacetCounts({ ...empty, sexes: ["worker"] });
    // Workers are bees + ants + wasps; butterflies should be 0.
    const but = snap.taxonGroups.find((g) => g.name === "butterflies");
    expect(but).toBeDefined();
    expect(but!.count).toBe(0);
  });
});
