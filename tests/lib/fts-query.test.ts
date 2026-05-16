/**
 * Unit tests for the FTS5 query builder helpers in lib/queries/gallery.ts.
 *
 * These functions take raw user input and translate it into an FTS5
 * MATCH expression. Correctness here matters for two reasons:
 *   1. Injection safety — every user token must end up quoted so
 *      FTS5 operators (AND / OR / NOT / NEAR) are treated as literal
 *      text, never as control words.
 *   2. UX — multi-token tags should AND internally, the trailing
 *      token gets a prefix marker so partial typing matches.
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { buildFtsTag, buildFtsQuery } from "@/lib/queries/gallery";
import { sqlite } from "@/db";

describe("buildFtsTag", () => {
  it("returns null on empty input", () => {
    expect(buildFtsTag("")).toBeNull();
    expect(buildFtsTag("   ")).toBeNull();
  });

  it("returns null when input is only punctuation / non-word characters", () => {
    expect(buildFtsTag("---")).toBeNull();
    expect(buildFtsTag(`"""`)).toBeNull();
  });

  it("wraps a single token in quotes with a trailing prefix marker", () => {
    expect(buildFtsTag("bee")).toBe(`"bee"*`);
  });

  it("AND-joins multi-token tags and prefix-matches the last word", () => {
    expect(buildFtsTag("tiger swal")).toBe(`"tiger" "swal"*`);
    expect(buildFtsTag("eastern tiger swal")).toBe(`"eastern" "tiger" "swal"*`);
  });

  it("neutralizes FTS5 operators by quoting them as literal tokens", () => {
    // AND / OR / NOT / NEAR are bare words in FTS5 grammar; quoting
    // them turns them into ordinary search terms. The builder relies
    // on the per-token quoting to prevent operator injection.
    expect(buildFtsTag("bee OR honey")).toBe(`"bee" "OR" "honey"*`);
    expect(buildFtsTag("bee AND wasp")).toBe(`"bee" "AND" "wasp"*`);
    expect(buildFtsTag("NOT bee")).toBe(`"NOT" "bee"*`);
    expect(buildFtsTag("bee NEAR wasp")).toBe(`"bee" "NEAR" "wasp"*`);
  });

  it("strips embedded double quotes so they can't escape the quoted token", () => {
    // The sanitizer drops every non-alphanumeric, non-whitespace
    // character. A double-quote injection like  bee" OR "  collapses
    // to  bee OR  which is then re-quoted token-by-token.
    expect(buildFtsTag('bee" OR "honey')).toBe(`"bee" "OR" "honey"*`);
    expect(buildFtsTag('"injected"')).toBe(`"injected"*`);
  });
});

describe("buildFtsQuery", () => {
  it("returns null on empty input", () => {
    expect(buildFtsQuery([])).toBeNull();
    expect(buildFtsQuery([""])).toBeNull();
    expect(buildFtsQuery(["", "   "])).toBeNull();
  });

  it("renders one tag as a single parenthesized subexpression", () => {
    expect(buildFtsQuery(["bee"])).toBe(`("bee"*)`);
  });

  it("OR-joins multiple tags, parenthesizing each", () => {
    expect(buildFtsQuery(["bee", "wasp"])).toBe(`("bee"*) OR ("wasp"*)`);
    expect(buildFtsQuery(["tiger swal", "monarch"])).toBe(
      `("tiger" "swal"*) OR ("monarch"*)`,
    );
  });

  it("drops empty / un-sanitizable tags but keeps the rest", () => {
    expect(buildFtsQuery(["bee", "", "wasp"])).toBe(`("bee"*) OR ("wasp"*)`);
    expect(buildFtsQuery(["bee", "---", "wasp"])).toBe(`("bee"*) OR ("wasp"*)`);
  });

  it("produces an FTS5-valid query that sqlite accepts at runtime", () => {
    // The in-memory test DB has an `images_fts` virtual table (see
    // tests/fixtures/init-db.ts). Running the produced expression
    // through MATCH proves FTS5 parses it without error — the
    // strongest functional check we can do without a corpus.
    for (const tag of [
      "bee",
      "tiger swallowtail",
      "bee OR honey",
      'bee" OR "honey',
      "monarch",
    ]) {
      const q = buildFtsQuery([tag]);
      expect(q).not.toBeNull();
      // Inline-binding via drizzle's sql tag keeps this safe; we just
      // want to know sqlite doesn't throw on the produced expression.
      expect(() =>
        sqlite
          .prepare(`SELECT 1 FROM images_fts WHERE images_fts MATCH ?`)
          .all(q!),
      ).not.toThrow();
    }
    // Sanity: the drizzle import path stays unbroken — keeps the
    // import statement above from being treated as dead by tsc.
    expect(sql`1`).toBeDefined();
  });
});
