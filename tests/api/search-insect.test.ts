import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/search/insect/route";

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

  it("empty query returns empty results", async () => {
    const data = await call("");
    expect(data.results).toEqual([]);
  });
});
