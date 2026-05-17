import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sketchfab/search", () => ({
  searchSketchfab: vi.fn(),
}));

vi.mock("@/lib/sketchfab/cache", () => ({
  getSpeciesCache: vi.fn(),
}));

import { GET } from "@/app/api/sketchfab/search/route";
import { searchSketchfab } from "@/lib/sketchfab/search";
import { getSpeciesCache } from "@/lib/sketchfab/cache";

describe("GET /api/sketchfab/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SKETCHFAB_API_KEY = "test-key";
    // Default: no cache row (unchecked species) so the route falls through
    // to the live API call. Individual tests override as needed.
    (getSpeciesCache as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  it("400s when scientific is missing", async () => {
    const r = await GET(new Request("http://x/api/sketchfab/search?common=bee"));
    expect(r.status).toBe(400);
  });

  it("400s when common is missing", async () => {
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=Apis"));
    expect(r.status).toBe(400);
  });

  it("500s when SKETCHFAB_API_KEY is missing AND cache is empty (live call needed)", async () => {
    delete process.env.SKETCHFAB_API_KEY;
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=Apis&common=bee"));
    expect(r.status).toBe(500);
  });

  it("serves cached hits directly without calling Sketchfab live", async () => {
    const cachedHit = {
      uid: "u1", name: "Bee", author: "x", authorUsername: "x",
      thumbnailUrl: "https://t", viewerUrl: "https://v",
      licenseSlug: "by", matchedBy: "scientific" as const,
    };
    (getSpeciesCache as ReturnType<typeof vi.fn>).mockReturnValue({
      hasModels: true,
      hits: [cachedHit],
      lastCheckedAt: new Date(),
    });
    const r = await GET(new Request(
      "http://x/api/sketchfab/search?scientific=Apis%20mellifera&common=honey%20bee"
    ));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0].uid).toBe("u1");
    expect(body.precachedHasModels).toBe(true);
    expect(searchSketchfab).not.toHaveBeenCalled();
  });

  it("calls searchSketchfab on cache miss + returns JSON", async () => {
    (searchSketchfab as ReturnType<typeof vi.fn>).mockResolvedValue({
      hits: [{ uid: "u1", name: "Bee", author: "x", authorUsername: "x",
               thumbnailUrl: "https://t", viewerUrl: "https://v",
               licenseSlug: "by", matchedBy: "scientific" }],
      rawHadResults: true,
    });
    const r = await GET(new Request(
      "http://x/api/sketchfab/search?scientific=Apis%20mellifera&common=honey%20bee"
    ));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.hits).toHaveLength(1);
    expect(body.precachedHasModels).toBeNull();
    expect(searchSketchfab).toHaveBeenCalledWith({
      scientific: "Apis mellifera",
      common: "honey bee",
      apiKey: "test-key",
    });
  });

  it("sets a short s-maxage cache header on every 200 response", async () => {
    (searchSketchfab as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: [], rawHadResults: false });
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=A&common=b"));
    expect(r.headers.get("Cache-Control")).toMatch(/s-maxage=\d+/);
  });

  it("502s when searchSketchfab throws on cache-miss live call", async () => {
    (searchSketchfab as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Sketchfab search failed: 401 Unauthorized")
    );
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=A&common=b"));
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body.error).toBe("upstream search failed");
    expect(body.detail).toContain("401");
  });

  it("short-circuits with empty hits when precache says no models", async () => {
    (getSpeciesCache as ReturnType<typeof vi.fn>).mockReturnValue({
      hasModels: false,
      hits: [],
      lastCheckedAt: new Date(),
    });
    const r = await GET(new Request(
      "http://x/api/sketchfab/search?scientific=Nothing&common=here"
    ));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.hits).toEqual([]);
    expect(body.precachedHasModels).toBe(false);
    expect(searchSketchfab).not.toHaveBeenCalled();
  });
});
