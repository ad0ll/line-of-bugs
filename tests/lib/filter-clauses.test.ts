import { describe, it, expect } from "vitest";
import { buildFilterClauses, type FilterState } from "@/lib/queries/filter-clauses";

const base: FilterState = {
  subjectType: "all",
  views: [],
  lifeStages: [],
  sexes: [],
  groups: [],
};

describe("buildFilterClauses", () => {
  it("returns just the visibility predicates when no filters set", () => {
    expect(buildFilterClauses(base)).toHaveLength(2);
  });

  it("adds a subject_state clause for any non-'all' subject", () => {
    expect(buildFilterClauses({ ...base, subjectType: "wild" })).toHaveLength(3);
    expect(buildFilterClauses({ ...base, subjectType: "captive" })).toHaveLength(3);
    expect(buildFilterClauses({ ...base, subjectType: "specimen" })).toHaveLength(3);
  });

  it("adds a taxon_subgroup clause when groups are selected", () => {
    expect(buildFilterClauses({ ...base, groups: ["butterflies"] })).toHaveLength(3);
  });

  it("skips axes with empty arrays", () => {
    expect(buildFilterClauses({ ...base, lifeStages: ["adult"] })).toHaveLength(3);
  });

  it("stacks all axes when several are active", () => {
    const clauses = buildFilterClauses({
      ...base,
      subjectType: "wild",
      views: ["dorsal"],
      lifeStages: ["adult"],
      sexes: ["male"],
      groups: ["butterflies"],
    });
    // 2 base + subject + view + life + sex + group = 7
    expect(clauses).toHaveLength(7);
  });
});
