import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/sketchfab/search", () => ({
  searchSketchfab: vi.fn(),
}));

import { GET } from "@/app/api/sketchfab/search/route";
import { searchSketchfab } from "@/lib/sketchfab/search";

describe("GET /api/sketchfab/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SKETCHFAB_API_KEY = "test-key";
  });

  it("400s when scientific OR common is missing", async () => {
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=Apis"));
    expect(r.status).toBe(400);
  });

  it("500s when SKETCHFAB_API_KEY is missing", async () => {
    delete process.env.SKETCHFAB_API_KEY;
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=Apis&common=bee"));
    expect(r.status).toBe(500);
  });

  it("calls searchSketchfab with parsed params + returns JSON", async () => {
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
    expect(body.hits[0].uid).toBe("u1");
    expect(searchSketchfab).toHaveBeenCalledWith({
      scientific: "Apis mellifera",
      common: "honey bee",
      apiKey: "test-key",
    });
  });

  it("sets a short s-maxage cache header so the CDN can hold it briefly", async () => {
    (searchSketchfab as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: [], rawHadResults: false });
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=A&common=b"));
    expect(r.headers.get("Cache-Control")).toMatch(/s-maxage=\d+/);
  });

  it("502s when searchSketchfab throws (upstream failure)", async () => {
    (searchSketchfab as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Sketchfab search failed: 401 Unauthorized")
    );
    const r = await GET(new Request("http://x/api/sketchfab/search?scientific=A&common=b"));
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body.error).toBe("upstream search failed");
    expect(body.detail).toContain("401");
  });
});
