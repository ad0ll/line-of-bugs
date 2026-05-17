import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchSketchfab } from "@/lib/sketchfab/search";

const sciHit = {
  uid: "sci123",
  name: "Apis mellifera - CT Scan",
  description: "Apis mellifera, museum specimen",
  user: { username: "etainproject", displayName: "ETAIN" },
  tags: [{ name: "insect" }, { name: "bee" }],
  categories: [{ name: "Animals & Pets", slug: "animals-pets" }],
  thumbnails: { images: [
    { width: 256, height: 144, url: "https://media.sketchfab.com/thumb-256.jpg" },
    { width: 1024, height: 576, url: "https://media.sketchfab.com/thumb-1024.jpg" },
  ]},
  viewerUrl: "https://sketchfab.com/3d-models/apis-mellifera-sci123",
  license: { slug: "by" },
};

const comHit = {
  uid: "com456",
  name: "Honey Bee model",
  description: "low-poly honey bee",
  user: { username: "modeler", displayName: "Modeler" },
  tags: [{ name: "bee" }],
  categories: [{ name: "Animals & Pets", slug: "animals-pets" }],
  thumbnails: { images: [
    { width: 256, height: 144, url: "https://media.sketchfab.com/com-256.jpg" },
  ]},
  viewerUrl: "https://sketchfab.com/3d-models/honey-bee-com456",
  license: { slug: "by-nc" },
};

describe("searchSketchfab", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("merges parallel sci + common results and dedupes by uid", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      const q = u.searchParams.get("q");
      const results = q === "Apis mellifera" ? [sciHit, comHit] : [comHit];
      return new Response(JSON.stringify({ results }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await searchSketchfab({
      scientific: "Apis mellifera", common: "honey bee", apiKey: "k",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.hits.map(h => h.uid).sort()).toEqual(["com456", "sci123"]);
    expect(out.hits.find(h => h.uid === "sci123")?.matchedBy).toBe("scientific");
    expect(out.hits.find(h => h.uid === "com456")?.matchedBy).toBe("both");
    expect(out.rawHadResults).toBe(true);
  });

  it("returns empty hits + rawHadResults=false when both queries miss", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 })
    ));
    const out = await searchSketchfab({
      scientific: "Nonexistus speciosus", common: "fake bug", apiKey: "k",
    });
    expect(out.hits).toEqual([]);
    expect(out.rawHadResults).toBe(false);
  });

  it("drops fuzzy username-only matches (no insect signal)", async () => {
    const noise = {
      ...sciHit, uid: "noise", name: "Bread",
      description: "bread model",
      tags: [{ name: "food" }],
      categories: [{ name: "Food & Drink", slug: "food-drink" }],
      user: { username: "vanessa3d", displayName: "Vanessa3D" },
    };
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ results: [noise] }), { status: 200 })
    ));
    const out = await searchSketchfab({
      scientific: "Vanessa itea", common: "Yellow Admiral", apiKey: "k",
    });
    expect(out.hits).toEqual([]);
    expect(out.rawHadResults).toBe(true); // had raw results but filtered out
  });

  it("picks the 256x144 thumbnail, not the largest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ results: [sciHit] }), { status: 200 })
    ));
    const out = await searchSketchfab({
      scientific: "Apis mellifera", common: "honey bee", apiKey: "k",
    });
    expect(out.hits[0]?.thumbnailUrl).toBe("https://media.sketchfab.com/thumb-256.jpg");
  });
});
