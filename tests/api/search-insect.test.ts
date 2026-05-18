import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/search/insect/route";
import { sqlite } from "@/db";
import { markRejected } from "../fixtures/init-db";

interface ResultRow {
  kind: "group" | "species";
  value: string;
  label: string;
  count: number;
}

async function call(q: string): Promise<{ results: ResultRow[] }> {
  const res = await GET(new Request(`http://localhost/api/search/insect?q=${encodeURIComponent(q)}`));
  expect(res.ok).toBe(true);
  return (await res.json()) as { results: ResultRow[] };
}

describe("GET /api/search/insect", () => {
  // Reset gate_decisions before every test — keeps tests order-independent
  // and prevents leaks between the autocomplete tests (which mutate the
  // table) and the basic-behavior tests above (which assume empty state).
  beforeEach(() => {
    sqlite.prepare("DELETE FROM gate_decisions").run();
  });

  it("typing 'but' returns the butterflies group AND any matching species", async () => {
    const data = await call("but");
    const kinds = new Set(data.results.map((r) => r.kind));
    expect(kinds.has("group")).toBe(true);
    // Test fixture seeds species named "butterfly N" which match the FTS
    // index too, so we should see both group + species results.
    expect(kinds.has("species")).toBe(true);
    const butterfliesGroup = data.results.find((r) => r.kind === "group" && /butter/i.test(r.label));
    expect(butterfliesGroup).toBeDefined();
    expect(butterfliesGroup!.count).toBeGreaterThan(0);
  });

  it("typing a species name returns species results", async () => {
    // Fixture seeds species like "butterfly 1", "moth 2", etc.
    const data = await call("moth");
    expect(data.results.some((r) => r.kind === "species" && /moth/i.test(r.label))).toBe(true);
  });

  it("empty query returns all groups sorted by count desc", async () => {
    const data = await call("");
    expect(data.results.length).toBeGreaterThan(0);
    // Every result is a group (no species without a search query)
    expect(data.results.every((r) => r.kind === "group")).toBe(true);
    // Counts are sorted desc
    for (let i = 1; i < data.results.length; i++) {
      expect(data.results[i]!.count).toBeLessThanOrEqual(data.results[i - 1]!.count);
    }
    // The "butterflies" group should be in the list with a positive count
    // (fixture seeds plenty of butterfly rows)
    const butterflies = data.results.find((r) => r.value === "butterflies");
    expect(butterflies).toBeDefined();
    expect(butterflies!.count).toBeGreaterThan(0);

    // The "weird" group has catchesNull: true and must include NULL-
    // taxon_subgroup rows in its count (regression guard).
    const weird = data.results.find((r) => r.value === "weird");
    expect(weird).toBeDefined();
    // Fixture seeds 2 NULL-subgroup rows; "weird" has no dbValue matches
    // in the fixture, so the entire count comes from the NULL rollup.
    expect(weird!.count).toBeGreaterThanOrEqual(2);
  });

  it("excludes a rejected image from group counts", async () => {
    const before = await GET(
      new Request("http://localhost/api/search/insect?q=butterf"),
    );
    const beforeBody = (await before.json()) as { results: Array<{ kind: string; label: string; count: number }> };
    const beforeGroup = beforeBody.results.find((r) => r.kind === "group" && r.label.toLowerCase().includes("butterf"));
    expect(beforeGroup?.count).toBeGreaterThan(0);
    const beforeCount = beforeGroup!.count;

    // Mark one butterfly rejected.
    const butterfly = sqlite
      .prepare("SELECT image_id FROM images WHERE taxon_subgroup = 'butterfly' LIMIT 1")
      .get() as { image_id: string };
    markRejected(butterfly.image_id);

    const after = await GET(
      new Request("http://localhost/api/search/insect?q=butterf"),
    );
    const afterBody = (await after.json()) as { results: Array<{ kind: string; label: string; count: number }> };
    const afterGroup = afterBody.results.find((r) => r.kind === "group" && r.label.toLowerCase().includes("butterf"));
    expect(afterGroup?.count).toBe(beforeCount - 1);
  });

  it("excludes rejected images from species autocomplete counts", async () => {
    const before = await GET(
      new Request("http://localhost/api/search/insect?q=Testus"),
    );
    const beforeBody = (await before.json()) as { results: Array<{ kind: string; count: number }> };
    const beforeSpeciesSum = beforeBody.results
      .filter((r) => r.kind === "species")
      .reduce((s, r) => s + r.count, 0);
    expect(beforeSpeciesSum).toBeGreaterThan(0);

    // Pick any image whose species matches the FTS query.
    const target = sqlite
      .prepare("SELECT image_id FROM images WHERE taxon_species LIKE 'Testus%' LIMIT 1")
      .get() as { image_id: string };
    markRejected(target.image_id);

    const after = await GET(
      new Request("http://localhost/api/search/insect?q=Testus"),
    );
    const afterBody = (await after.json()) as { results: Array<{ kind: string; count: number }> };
    const afterSpeciesSum = afterBody.results
      .filter((r) => r.kind === "species")
      .reduce((s, r) => s + r.count, 0);
    expect(afterSpeciesSum).toBe(beforeSpeciesSum - 1);
  });
});
