import { describe, it, expect } from "vitest";
import { getFacetCounts } from "@/lib/queries/facets";
import type { FilterState } from "@/lib/queries/filter-clauses";
import { FIXTURE } from "@/tests/fixtures/init-db";

// Runs against the 34-row in-memory fixture seeded in tests/setup.ts.
// Counts are exact (not "greater than N") because the fixture is
// frozen.

const empty: FilterState = {
  subjectType: "all",
  views: [],
  lifeStages: [],
  sexes: [],
  groups: [],
};

describe("getFacetCounts", () => {
  it("returns total + counts for every axis when no filters applied", async () => {
    const snap = await getFacetCounts(empty);
    expect(snap.total).toBe(FIXTURE.total);
    expect(snap.subject.wild).toBe(FIXTURE.subject.wild);
    expect(snap.subject.captive).toBe(FIXTURE.subject.captive);
    expect(snap.subject.specimen).toBe(FIXTURE.subject.specimen);
    expect(snap.taxonGroups.length).toBe(21);
    expect(snap.taxonGroups.find((g) => g.name === "butterflies")?.count).toBe(
      FIXTURE.taxon.butterflies.total,
    );
  });

  it("cross-axis: switching subject from wild to specimen changes butterfly count", async () => {
    const wild = await getFacetCounts({ ...empty, subjectType: "wild" });
    const specimen = await getFacetCounts({ ...empty, subjectType: "specimen" });
    expect(wild.taxonGroups.find((g) => g.name === "butterflies")!.count).toBe(
      FIXTURE.taxon.butterflies.wild,
    );
    expect(specimen.taxonGroups.find((g) => g.name === "butterflies")!.count).toBe(
      FIXTURE.taxon.butterflies.specimen,
    );
  });

  it("within-axis: selecting butterflies leaves cockroach bucket UNCHANGED", async () => {
    const baseline = await getFacetCounts(empty);
    const withBut = await getFacetCounts({ ...empty, groups: ["butterflies"] });
    expect(baseline.taxonGroups.find((g) => g.name === "cockroaches")!.count).toBe(
      FIXTURE.taxon.cockroaches.total,
    );
    expect(withBut.taxonGroups.find((g) => g.name === "cockroaches")!.count).toBe(
      FIXTURE.taxon.cockroaches.total,
    );
  });

  it("within-axis: selecting butterflies leaves butterfly bucket UNCHANGED (own-axis exclusion)", async () => {
    const withBut = await getFacetCounts({ ...empty, groups: ["butterflies"] });
    expect(withBut.taxonGroups.find((g) => g.name === "butterflies")!.count).toBe(
      FIXTURE.taxon.butterflies.total,
    );
  });

  it("total narrows when multiple axes filter", async () => {
    const all = await getFacetCounts(empty);
    const captiveButterflies = await getFacetCounts({
      ...empty,
      subjectType: "captive",
      groups: ["butterflies"],
    });
    expect(captiveButterflies.total).toBe(FIXTURE.taxon.butterflies.captive);
    expect(captiveButterflies.total).toBeLessThan(all.total);
  });

  it("subject facet ignores its own selection", async () => {
    const snap = await getFacetCounts({ ...empty, subjectType: "wild" });
    expect(snap.subject.captive).toBe(FIXTURE.subject.captive);
    expect(snap.subject.specimen).toBe(FIXTURE.subject.specimen);
  });

  it("returns zero-count taxon buckets so the UI can grey them out", async () => {
    // Fixture has workers only on bees + ants. Butterflies have no
    // worker-sex rows, so filtering sex=worker must zero the
    // butterflies bucket while keeping the array entry.
    const snap = await getFacetCounts({ ...empty, sexes: ["worker"] });
    const but = snap.taxonGroups.find((g) => g.name === "butterflies");
    expect(but).toBeDefined();
    expect(but!.count).toBe(0);
  });
});
