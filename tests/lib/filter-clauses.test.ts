import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { buildFilterClauses, type FilterState } from "@/lib/queries/filter-clauses";

const base: FilterState = {
  subjectType: "all",
  views: [],
  lifeStages: [],
  sexes: [],
  groups: [],
};

// Render the combined WHERE expression to a positional-param SQL string
// so we can assert the actual tokens emitted, not just the clause count.
// Drizzle's sqlite dialect serializes user-supplied values as `?`
// placeholders — exactly what we want for an injection-safety check.
const dialect = new SQLiteSyncDialect();
function renderWhere(state: FilterState): { sql: string; params: unknown[] } {
  const clauses = buildFilterClauses(state);
  const q = dialect.sqlToQuery(sql.join(clauses, sql` AND `));
  return { sql: q.sql, params: q.params };
}

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

  // ─── SQL content assertions ────────────────────────────────────────
  // These confirm the rendered SQL contains the expected tokens, and
  // that all user-controlled values flow through bound parameters
  // rather than being interpolated into the query text. That's our
  // defense-in-depth check against SQL injection regressions.

  it("renders subject_state via bound parameters (not inline)", () => {
    const { sql: text, params } = renderWhere({ ...base, subjectType: "wild" });
    expect(text).toContain("subject_state");
    expect(text).toContain("hidden = 0");
    expect(text).toContain("NOT EXISTS");
    // Subject value bound, not inlined into the SQL text.
    expect(text).not.toContain("'wild'");
    expect(params).toContain("wild");
  });

  it("emits IN (...) for view_label and parameterizes every value", () => {
    const { sql: text, params } = renderWhere({
      ...base,
      views: ["dorsal", "ventral"],
    });
    expect(text).toContain("view_label");
    expect(text).toMatch(/IN \(\?, \?\)/);
    expect(text).not.toContain("'dorsal'");
    expect(text).not.toContain("'ventral'");
    expect(params).toEqual(expect.arrayContaining(["dorsal", "ventral"]));
  });

  it("expands the 'unknown' sentinel into an IS NULL / empty-string predicate", () => {
    const { sql: text, params } = renderWhere({
      ...base,
      lifeStages: ["adult", "unknown"],
    });
    expect(text).toContain("life_stage");
    expect(text).toContain("IS NULL");
    expect(text).toContain("OR");
    // "unknown" itself must not appear as a bound life_stage value —
    // it's a synthetic facet token, not a column value.
    expect(params).not.toContain("unknown");
    expect(params).toContain("adult");
  });
});
